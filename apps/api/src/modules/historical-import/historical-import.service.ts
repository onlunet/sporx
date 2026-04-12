import { BadRequestException, Injectable } from "@nestjs/common";
import { MatchStatus, Prisma } from "@prisma/client";
import { parse } from "csv-parse/sync";
import { access, readFile } from "node:fs/promises";
import { PrismaService } from "../../prisma/prisma.service";

type CsvRow = Record<string, string | undefined>;

type EloPoint = {
  at: number;
  elo: number;
};

type EloIndex = {
  byClub: Map<string, EloPoint[]>;
  byClubCountry: Map<string, EloPoint[]>;
};

type PreparedMatch = {
  divisionCode: string;
  seasonLabel: string;
  kickoffAt: Date;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCountry: string;
  awayTeamCountry: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  halfTimeHomeScore: number | null;
  halfTimeAwayScore: number | null;
  resultCode: string | null;
  oddsHome: number | null;
  oddsDraw: number | null;
  oddsAway: number | null;
  maxOddsHome: number | null;
  maxOddsDraw: number | null;
  maxOddsAway: number | null;
  over25: number | null;
  under25: number | null;
  maxOver25: number | null;
  maxUnder25: number | null;
  homeElo: number | null;
  awayElo: number | null;
  form3Home: number | null;
  form5Home: number | null;
  form3Away: number | null;
  form5Away: number | null;
};

@Injectable()
export class HistoricalImportService {
  private readonly countryByDivisionPrefix: Record<string, string> = {
    ARG: "ARG",
    AUT: "AUT",
    B: "BEL",
    BEL: "BEL",
    BRA: "BRA",
    CHN: "CHN",
    CRO: "HRV",
    CZE: "CZE",
    D: "DEU",
    DEN: "DNK",
    E: "ENG",
    EC: "ENG",
    F: "FRA",
    FIN: "FIN",
    G: "GRC",
    HUN: "HUN",
    I: "ITA",
    IRL: "IRL",
    JAP: "JPN",
    MEX: "MEX",
    N: "NLD",
    NOR: "NOR",
    P: "PRT",
    POL: "POL",
    ROM: "ROU",
    RUS: "RUS",
    SC: "SCO",
    SLK: "SVK",
    SP: "ESP",
    SWE: "SWE",
    T: "TUR",
    TUR: "TUR",
    USA: "USA"
  };

  constructor(private readonly prisma: PrismaService) {}

  async importCsv(matchesPath: string, eloPath: string) {
    await this.assertReadableCsv(matchesPath, "matchesPath");
    await this.assertReadableCsv(eloPath, "eloPath");

    const run = await this.prisma.historicalImportRun.create({
      data: {
        sourceName: "Club-Football-Match-Data-2000-2025",
        status: "running",
        startedAt: new Date()
      }
    });

    try {
      const [matchesRaw, eloRaw] = await Promise.all([readFile(matchesPath, "utf8"), readFile(eloPath, "utf8")]);
      const matchesRows = parse(matchesRaw, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        relax_column_count: true
      }) as CsvRow[];
      const eloRows = parse(eloRaw, {
        columns: true,
        skip_empty_lines: true,
        bom: true,
        relax_column_count: true
      }) as CsvRow[];

      const provider = await this.prisma.provider.upsert({
        where: { key: "historical_csv" },
        update: { name: "Historical CSV", isActive: true },
        create: {
          key: "historical_csv",
          name: "Historical CSV",
          isActive: true
        }
      });

      const sport = await this.prisma.sport.upsert({
        where: { code: "football" },
        update: { name: "Football" },
        create: { code: "football", name: "Football" }
      });

      const eloIndex = this.buildEloIndex(eloRows);
      const now = new Date();

      const leagues = new Map<string, { divisionCode: string; country: string }>();
      const teams = new Map<string, { name: string; country: string; normalizedAlias: string }>();
      const preparedMatches: PreparedMatch[] = [];
      const conflictSamples: string[] = [];
      let parseConflicts = 0;

      for (let i = 0; i < matchesRows.length; i += 1) {
        const row = matchesRows[i];
        const rowNumber = i + 2;

        const divisionCode = (row.Division ?? "").trim().toUpperCase();
        const homeTeamName = (row.HomeTeam ?? "").trim();
        const awayTeamName = (row.AwayTeam ?? "").trim();

        if (!divisionCode || !homeTeamName || !awayTeamName) {
          parseConflicts += 1;
          if (conflictSamples.length < 25) {
            conflictSamples.push(`row ${rowNumber}: missing Division/HomeTeam/AwayTeam`);
          }
          continue;
        }

        const kickoffAt = this.parseMatchDateTime(row.MatchDate, row.MatchTime);
        if (!kickoffAt) {
          parseConflicts += 1;
          if (conflictSamples.length < 25) {
            conflictSamples.push(`row ${rowNumber}: invalid MatchDate/MatchTime`);
          }
          continue;
        }

        const leagueCountry = this.inferCountryCode(divisionCode);
        const seasonLabel = this.buildSeasonLabel(kickoffAt);
        leagues.set(divisionCode, { divisionCode, country: leagueCountry });

        this.registerTeam(teams, homeTeamName, leagueCountry);
        this.registerTeam(teams, awayTeamName, leagueCountry);

        const homeElo = this.parseNullableFloat(row.HomeElo) ?? this.resolveElo(eloIndex, homeTeamName, leagueCountry, kickoffAt);
        const awayElo = this.parseNullableFloat(row.AwayElo) ?? this.resolveElo(eloIndex, awayTeamName, leagueCountry, kickoffAt);

        const homeScore = this.parseNullableInt(row.FTHome);
        const awayScore = this.parseNullableInt(row.FTAway);

        preparedMatches.push({
          divisionCode,
          seasonLabel,
          kickoffAt,
          homeTeamName,
          awayTeamName,
          homeTeamCountry: leagueCountry,
          awayTeamCountry: leagueCountry,
          status: homeScore !== null && awayScore !== null ? MatchStatus.finished : MatchStatus.scheduled,
          homeScore,
          awayScore,
          halfTimeHomeScore: this.parseNullableInt(row.HTHome),
          halfTimeAwayScore: this.parseNullableInt(row.HTAway),
          resultCode: this.toNullableString(row.FTResult),
          oddsHome: this.parseNullableFloat(row.OddHome),
          oddsDraw: this.parseNullableFloat(row.OddDraw),
          oddsAway: this.parseNullableFloat(row.OddAway),
          maxOddsHome: this.parseNullableFloat(row.MaxHome),
          maxOddsDraw: this.parseNullableFloat(row.MaxDraw),
          maxOddsAway: this.parseNullableFloat(row.MaxAway),
          over25: this.parseNullableFloat(row.Over25),
          under25: this.parseNullableFloat(row.Under25),
          maxOver25: this.parseNullableFloat(row.MaxOver25),
          maxUnder25: this.parseNullableFloat(row.MaxUnder25),
          homeElo,
          awayElo,
          form3Home: this.parseNullableFloat(row.Form3Home),
          form5Home: this.parseNullableFloat(row.Form5Home),
          form3Away: this.parseNullableFloat(row.Form3Away),
          form5Away: this.parseNullableFloat(row.Form5Away)
        });
      }

      const leagueIdByDivision = new Map<string, string>();
      for (const league of leagues.values()) {
        const saved = await this.prisma.league.upsert({
          where: {
            sportId_name: {
              sportId: sport.id,
              name: league.divisionCode
            }
          },
          update: {
            code: league.divisionCode,
            country: league.country,
            dataSource: "historical_csv",
            importedAt: now,
            updatedByProcess: "historical_import"
          },
          create: {
            sportId: sport.id,
            name: league.divisionCode,
            code: league.divisionCode,
            country: league.country,
            dataSource: "historical_csv",
            importedAt: now,
            updatedByProcess: "historical_import"
          }
        });
        leagueIdByDivision.set(league.divisionCode, saved.id);
      }

      const seasonIdByKey = new Map<string, string>();
      for (const match of preparedMatches) {
        const leagueId = leagueIdByDivision.get(match.divisionCode);
        if (!leagueId) {
          parseConflicts += 1;
          continue;
        }

        const seasonKey = `${leagueId}::${match.seasonLabel}`;
        if (seasonIdByKey.has(seasonKey)) {
          continue;
        }

        const [startYearRaw, endYearRaw] = match.seasonLabel.split("-");
        const startYear = Number(startYearRaw);
        const endYear = Number(endYearRaw);

        const season = await this.prisma.season.upsert({
          where: {
            leagueId_yearLabel: {
              leagueId,
              yearLabel: match.seasonLabel
            }
          },
          update: {
            dataSource: "historical_csv",
            importedAt: now,
            updatedByProcess: "historical_import"
          },
          create: {
            leagueId,
            yearLabel: match.seasonLabel,
            startDate: new Date(Date.UTC(startYear, 6, 1, 0, 0, 0)),
            endDate: new Date(Date.UTC(endYear, 5, 30, 23, 59, 59)),
            dataSource: "historical_csv",
            importedAt: now,
            updatedByProcess: "historical_import"
          }
        });

        seasonIdByKey.set(seasonKey, season.id);
      }

      const teamIdByKey = new Map<string, string>();
      const teamMappings: Prisma.ProviderTeamMappingCreateManyInput[] = [];
      const teamAliases: Prisma.EntityAliasCreateManyInput[] = [];

      for (const team of teams.values()) {
        const saved = await this.prisma.team.upsert({
          where: {
            name_country: {
              name: team.name,
              country: team.country
            }
          },
          update: {
            dataSource: "historical_csv",
            importedAt: now,
            updatedByProcess: "historical_import"
          },
          create: {
            name: team.name,
            country: team.country,
            dataSource: "historical_csv",
            importedAt: now,
            updatedByProcess: "historical_import"
          }
        });

        const key = this.teamKey(team.name, team.country);
        teamIdByKey.set(key, saved.id);

        teamMappings.push({
          providerId: provider.id,
          teamId: saved.id,
          providerTeamKey: key,
          mappingConfidence: 0.99
        });

        teamAliases.push({
          entityType: "team",
          entityId: saved.id,
          alias: team.name,
          normalizedAlias: team.normalizedAlias,
          confidence: 0.99
        });
      }

      const leagueMappings = Array.from(leagueIdByDivision.entries()).map(([divisionCode, leagueId]) => ({
        providerId: provider.id,
        leagueId,
        providerLeagueKey: divisionCode,
        mappingConfidence: 1
      }));

      if (leagueMappings.length > 0) {
        await this.prisma.providerLeagueMapping.createMany({
          data: leagueMappings,
          skipDuplicates: true
        });
      }

      if (teamMappings.length > 0) {
        await this.prisma.providerTeamMapping.createMany({
          data: teamMappings,
          skipDuplicates: true
        });
      }

      if (teamAliases.length > 0) {
        await this.prisma.entityAlias.createMany({
          data: teamAliases,
          skipDuplicates: true
        });
      }

      const matchData: Prisma.MatchCreateManyInput[] = [];
      for (const match of preparedMatches) {
        const leagueId = leagueIdByDivision.get(match.divisionCode);
        if (!leagueId) {
          parseConflicts += 1;
          continue;
        }

        const seasonId = seasonIdByKey.get(`${leagueId}::${match.seasonLabel}`);
        const homeTeamId = teamIdByKey.get(this.teamKey(match.homeTeamName, match.homeTeamCountry));
        const awayTeamId = teamIdByKey.get(this.teamKey(match.awayTeamName, match.awayTeamCountry));

        if (!seasonId || !homeTeamId || !awayTeamId) {
          parseConflicts += 1;
          continue;
        }

        matchData.push({
          sportId: sport.id,
          leagueId,
          seasonId,
          homeTeamId,
          awayTeamId,
          divisionCode: match.divisionCode,
          matchDateTimeUTC: match.kickoffAt,
          status: match.status,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          halfTimeHomeScore: match.halfTimeHomeScore,
          halfTimeAwayScore: match.halfTimeAwayScore,
          resultCode: match.resultCode,
          oddsHome: match.oddsHome,
          oddsDraw: match.oddsDraw,
          oddsAway: match.oddsAway,
          maxOddsHome: match.maxOddsHome,
          maxOddsDraw: match.maxOddsDraw,
          maxOddsAway: match.maxOddsAway,
          over25: match.over25,
          under25: match.under25,
          maxOver25: match.maxOver25,
          maxUnder25: match.maxUnder25,
          homeElo: match.homeElo,
          awayElo: match.awayElo,
          form3Home: match.form3Home,
          form5Home: match.form5Home,
          form3Away: match.form3Away,
          form5Away: match.form5Away,
          dataSource: "historical_csv",
          importedAt: now,
          updatedByProcess: "historical_import",
          mappingConfidence: 0.98,
          dataQualityScore: 0.95
        });
      }

      let insertedMatches = 0;
      const chunks = this.chunk(matchData, 2000);
      for (const chunk of chunks) {
        const result = await this.prisma.match.createMany({
          data: chunk,
          skipDuplicates: true
        });
        insertedMatches += result.count;
      }

      const duplicateCount = matchData.length - insertedMatches;
      const totalConflicts = parseConflicts + duplicateCount;

      if (totalConflicts > 0) {
        await this.prisma.auditLog.create({
          data: {
            action: "historical_import_conflicts",
            resourceType: "HistoricalImportRun",
            resourceId: run.id,
            metadata: {
              parseConflicts,
              duplicateCount,
              samples: conflictSamples
            } as Prisma.InputJsonValue
          }
        });
      }

      await this.prisma.externalSourcePayload.createMany({
        data: [
          {
            providerKey: provider.key,
            entityType: "matches_csv_summary",
            entityExternalId: run.id,
            payload: {
              path: matchesPath,
              rows: matchesRows.length,
              preparedRows: preparedMatches.length,
              inserted: insertedMatches
            } as Prisma.InputJsonValue
          },
          {
            providerKey: provider.key,
            entityType: "elo_csv_summary",
            entityExternalId: run.id,
            payload: {
              path: eloPath,
              rows: eloRows.length
            } as Prisma.InputJsonValue
          }
        ]
      });

      await this.prisma.historicalImportRun.update({
        where: { id: run.id },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          recordsRead: matchesRows.length + eloRows.length,
          recordsMerged: insertedMatches,
          conflicts: totalConflicts,
          summary: {
            strategy: "merge_enrich",
            leagues: leagueIdByDivision.size,
            seasons: seasonIdByKey.size,
            teams: teamIdByKey.size,
            matchesPrepared: matchData.length,
            matchesInserted: insertedMatches,
            parseConflicts,
            duplicates: duplicateCount
          } as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown import failure";
      await this.prisma.historicalImportRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          summary: {
            strategy: "merge_enrich",
            error: message
          } as Prisma.InputJsonValue
        }
      });
      throw error;
    }

    return this.prisma.historicalImportRun.findUniqueOrThrow({ where: { id: run.id } });
  }

  status() {
    return this.prisma.historicalImportRun.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  }

  private async assertReadableCsv(filePath: string, fieldName: string) {
    if (!filePath || filePath.trim().length === 0) {
      throw new BadRequestException(`${fieldName} is required`);
    }
    if (!filePath.toLowerCase().endsWith(".csv")) {
      throw new BadRequestException(`${fieldName} must point to a .csv file`);
    }
    try {
      await access(filePath);
    } catch {
      throw new BadRequestException(`${fieldName} file does not exist or is not readable`);
    }
  }

  private registerTeam(
    map: Map<string, { name: string; country: string; normalizedAlias: string }>,
    name: string,
    country: string
  ) {
    const cleanName = name.trim();
    if (!cleanName) {
      return;
    }
    const key = this.teamKey(cleanName, country);
    if (!map.has(key)) {
      map.set(key, {
        name: cleanName,
        country,
        normalizedAlias: `${this.normalizeText(cleanName)}|${country}`
      });
    }
  }

  private teamKey(name: string, country: string) {
    return `${this.normalizeText(name)}|${country}`;
  }

  private normalizeText(value: string) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  private inferCountryCode(divisionCode: string) {
    const upper = divisionCode.toUpperCase().trim();
    const prefix = upper.replace(/[0-9]/g, "");
    return this.countryByDivisionPrefix[upper] ?? this.countryByDivisionPrefix[prefix] ?? "INT";
  }

  private parseMatchDateTime(matchDateRaw: string | undefined, matchTimeRaw: string | undefined): Date | null {
    const datePart = (matchDateRaw ?? "").trim();
    if (!datePart) {
      return null;
    }

    const timePartRaw = (matchTimeRaw ?? "").trim();
    const normalizedTime = timePartRaw.length > 0 ? timePartRaw : "12:00";
    const hhmmss = normalizedTime.length === 5 ? `${normalizedTime}:00` : normalizedTime;

    const iso = `${datePart}T${hhmmss}Z`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }

    const slashMatch = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(datePart);
    if (!slashMatch) {
      return null;
    }

    const [, dd, mm, yyyy] = slashMatch;
    const fallbackIso = `${yyyy}-${mm}-${dd}T${hhmmss}Z`;
    const fallbackParsed = new Date(fallbackIso);
    return Number.isNaN(fallbackParsed.getTime()) ? null : fallbackParsed;
  }

  private buildSeasonLabel(kickoffAt: Date) {
    const year = kickoffAt.getUTCFullYear();
    const month = kickoffAt.getUTCMonth() + 1;
    return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  }

  private parseNullableFloat(raw: string | undefined): number | null {
    if (raw === undefined) {
      return null;
    }
    const cleaned = raw.trim().replace(",", ".");
    if (!cleaned) {
      return null;
    }
    const value = Number(cleaned);
    return Number.isFinite(value) ? value : null;
  }

  private parseNullableInt(raw: string | undefined): number | null {
    const floatValue = this.parseNullableFloat(raw);
    if (floatValue === null) {
      return null;
    }
    return Math.round(floatValue);
  }

  private toNullableString(raw: string | undefined): string | null {
    const value = (raw ?? "").trim();
    return value.length === 0 ? null : value;
  }

  private buildEloIndex(eloRows: CsvRow[]): EloIndex {
    const byClub = new Map<string, EloPoint[]>();
    const byClubCountry = new Map<string, EloPoint[]>();

    for (const row of eloRows) {
      const club = (row.club ?? "").trim();
      const country = (row.country ?? "").trim().toUpperCase();
      const date = this.parseMatchDateTime(row.date, "12:00");
      const elo = this.parseNullableFloat(row.elo);
      if (!club || !country || !date || elo === null) {
        continue;
      }

      const point: EloPoint = { at: date.getTime(), elo };
      const clubKey = this.normalizeText(club);
      const clubCountryKey = `${clubKey}|${country}`;

      const clubPoints = byClub.get(clubKey) ?? [];
      clubPoints.push(point);
      byClub.set(clubKey, clubPoints);

      const clubCountryPoints = byClubCountry.get(clubCountryKey) ?? [];
      clubCountryPoints.push(point);
      byClubCountry.set(clubCountryKey, clubCountryPoints);
    }

    for (const points of byClub.values()) {
      points.sort((a, b) => a.at - b.at);
    }
    for (const points of byClubCountry.values()) {
      points.sort((a, b) => a.at - b.at);
    }

    return { byClub, byClubCountry };
  }

  private resolveElo(index: EloIndex, teamName: string, countryCode: string, kickoffAt: Date): number | null {
    const teamKey = this.normalizeText(teamName);
    const byCountry = index.byClubCountry.get(`${teamKey}|${countryCode}`);
    const fromCountry = this.findLatestElo(byCountry, kickoffAt.getTime());
    if (fromCountry !== null) {
      return fromCountry;
    }
    return this.findLatestElo(index.byClub.get(teamKey), kickoffAt.getTime());
  }

  private findLatestElo(points: EloPoint[] | undefined, at: number): number | null {
    if (!points || points.length === 0) {
      return null;
    }

    let left = 0;
    let right = points.length - 1;
    let matchIndex = -1;

    while (left <= right) {
      const middle = Math.floor((left + right) / 2);
      if (points[middle].at <= at) {
        matchIndex = middle;
        left = middle + 1;
      } else {
        right = middle - 1;
      }
    }

    return matchIndex >= 0 ? points[matchIndex].elo : null;
  }

  private chunk<T>(items: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}

