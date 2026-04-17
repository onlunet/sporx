import { Injectable, NotFoundException } from "@nestjs/common";
import { MatchStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { PredictionsService } from "../predictions/predictions.service";

type ListMatchesParams = {
  status?: string;
  sport?: string;
  take?: number;
};

const MATCH_STATUS_SET = new Set<MatchStatus>([
  MatchStatus.scheduled,
  MatchStatus.live,
  MatchStatus.finished,
  MatchStatus.postponed,
  MatchStatus.cancelled
]);

function parseStatusFilter(input?: string): MatchStatus[] | undefined {
  if (!input) {
    return undefined;
  }

  const values = input
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const unique: MatchStatus[] = [];
  for (const value of values) {
    if (MATCH_STATUS_SET.has(value as MatchStatus) && !unique.includes(value as MatchStatus)) {
      unique.push(value as MatchStatus);
    }
  }

  return unique.length > 0 ? unique : undefined;
}

function normalizeTake(take?: number): number {
  if (!Number.isFinite(take)) {
    return 80;
  }
  return Math.max(1, Math.min(300, Math.trunc(take ?? 80)));
}

function parseSportFilter(input?: string): "football" | "basketball" | undefined {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "football" || normalized === "soccer") {
    return "football";
  }
  if (normalized === "basketball" || normalized === "nba" || normalized === "basket") {
    return "basketball";
  }
  return undefined;
}

async function queryWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`query_timeout_${timeoutMs}`)), timeoutMs);
    })
  ]);
}

@Injectable()
export class MatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly predictionsService: PredictionsService
  ) {}

  async list(params?: ListMatchesParams) {
    const statuses = parseStatusFilter(params?.status);
    const sportCode = parseSportFilter(params?.sport);
    const effectiveStatuses = statuses ?? [MatchStatus.scheduled, MatchStatus.live, MatchStatus.finished];
    const take = normalizeTake(params?.take);
    const sportKey = sportCode ?? "all";
    const statusKey = effectiveStatuses.join("|");
    const cacheKey = `matches:list:v3:${sportKey}:${statusKey}:${take}`;
    const stableCacheKey = `${cacheKey}:stable`;
    const cached = await this.cache.get<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

    let matches:
      | Array<{
          id: string;
          matchDateTimeUTC: Date;
          status: MatchStatus;
          homeScore: number | null;
          awayScore: number | null;
          homeTeamId: string;
          awayTeamId: string;
          leagueId: string;
        }>
      | [] = [];

    const matchSelect = {
      id: true,
      matchDateTimeUTC: true,
      status: true,
      homeScore: true,
      awayScore: true,
      homeTeamId: true,
      awayTeamId: true,
      leagueId: true
    } as const;

    try {
      if (statuses && statuses.length === 1) {
        matches = await queryWithTimeout(
          this.prisma.match.findMany({
            where: {
              status: { in: effectiveStatuses },
              ...(sportCode ? { sport: { code: sportCode } } : {})
            },
            orderBy: { matchDateTimeUTC: "desc" },
            select: matchSelect,
            take
          }),
          12000
        );
      } else {
        const perStatusTake = Math.max(Math.ceil(take / effectiveStatuses.length) + 24, 40);
        const statusChunks = await Promise.all(
          effectiveStatuses.map(async (status) => {
            try {
              return await queryWithTimeout(
                this.prisma.match.findMany({
                  where: {
                    status,
                    ...(sportCode ? { sport: { code: sportCode } } : {})
                  },
                  orderBy: { matchDateTimeUTC: "desc" },
                  select: matchSelect,
                  take: perStatusTake
                }),
                9000
              );
            } catch {
              return [] as Array<{
                id: string;
                matchDateTimeUTC: Date;
                status: MatchStatus;
                homeScore: number | null;
                awayScore: number | null;
                homeTeamId: string;
                awayTeamId: string;
                leagueId: string;
              }>;
            }
          })
        );

        const mergedById = new Map<string, (typeof statusChunks)[number][number]>();
        for (const chunk of statusChunks) {
          for (const row of chunk) {
            mergedById.set(row.id, row);
          }
        }

        matches = Array.from(mergedById.values())
          .sort((left, right) => right.matchDateTimeUTC.getTime() - left.matchDateTimeUTC.getTime())
          .slice(0, take);
      }
    } catch {
      const stale = await this.cache.get<unknown[]>(stableCacheKey);
      if (stale) {
        await this.cache.set(cacheKey, stale, 12, ["matches"]);
        return stale;
      }
      return [];
    }

    const teamIds = Array.from(
      new Set(matches.flatMap((match) => [match.homeTeamId, match.awayTeamId]).filter((teamId) => teamId.length > 0))
    );
    const leagueIds = Array.from(new Set(matches.map((match) => match.leagueId).filter((leagueId) => leagueId.length > 0)));

    const [teams, leagues] = await Promise.all([
      queryWithTimeout(
        this.prisma.team.findMany({
          where: { id: { in: teamIds } },
          select: { id: true, name: true }
        }),
        6000
      ).catch(() => [] as Array<{ id: string; name: string }>),
      queryWithTimeout(
        this.prisma.league.findMany({
          where: { id: { in: leagueIds } },
          select: { id: true, name: true }
        }),
        6000
      ).catch(() => [] as Array<{ id: string; name: string }>)
    ]);

    const teamNameById = new Map(teams.map((team) => [team.id, team.name]));
    const leagueNameById = new Map(leagues.map((league) => [league.id, league.name]));

    const data = matches.map((match) => ({
      id: match.id,
      kickoffAt: match.matchDateTimeUTC.toISOString(),
      leagueName: leagueNameById.get(match.leagueId) ?? "Unknown League",
      homeTeam: teamNameById.get(match.homeTeamId) ?? "Unknown Home Team",
      awayTeam: teamNameById.get(match.awayTeamId) ?? "Unknown Away Team",
      status: match.status,
      score: { home: match.homeScore, away: match.awayScore }
    }));

    await this.cache.set(cacheKey, data, 120, ["matches"]);
    await this.cache.set(stableCacheKey, data, 600, ["matches"]);
    return data;
  }

  async getById(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: {
        id: true,
        sportId: true,
        leagueId: true,
        seasonId: true,
        homeTeamId: true,
        awayTeamId: true,
        matchDateTimeUTC: true,
        status: true,
        homeScore: true,
        awayScore: true,
        halfTimeHomeScore: true,
        halfTimeAwayScore: true,
        homeElo: true,
        awayElo: true,
        createdAt: true,
        updatedAt: true
      }
    });

    if (!match) {
      throw new NotFoundException("Match not found");
    }

    const [league, season, teams] = await Promise.all([
      this.prisma.league
        .findUnique({
          where: { id: match.leagueId },
          select: { id: true, name: true, code: true }
        })
        .catch(() => null),
      this.prisma.season
        .findUnique({
          where: { id: match.seasonId },
          select: { id: true, yearLabel: true }
        })
        .catch(() => null),
      this.prisma.team
        .findMany({
          where: { id: { in: [match.homeTeamId, match.awayTeamId] } },
          select: { id: true, name: true }
        })
        .catch(() => [])
    ]);

    const teamNameById = new Map(teams.map((team) => [team.id, team.name]));

    return {
      ...match,
      league: {
        id: league?.id ?? match.leagueId,
        name: league?.name ?? "Unknown League",
        code: league?.code ?? null
      },
      season: {
        id: season?.id ?? match.seasonId,
        yearLabel: season?.yearLabel ?? "Unknown Season"
      },
      homeTeam: {
        id: match.homeTeamId,
        name: teamNameById.get(match.homeTeamId) ?? "Unknown Home Team"
      },
      awayTeam: {
        id: match.awayTeamId,
        name: teamNameById.get(match.awayTeamId) ?? "Unknown Away Team"
      }
    };
  }

  events(id: string) {
    return this.prisma.matchEvent.findMany({ where: { matchId: id }, orderBy: { minute: "asc" } });
  }

  stats(id: string) {
    return this.prisma.teamStat.findMany({ where: { matchId: id }, include: { team: true } });
  }

  async prediction(id: string, predictionType?: string, line?: number, includeMarketAnalysis = false) {
    const lineNormalized = line !== undefined && Number.isFinite(line) ? Number(line.toFixed(2)) : undefined;
    const enriched = await this.predictionsService.listByMatch(id, {
      predictionType,
      line: lineNormalized,
      includeMarketAnalysis
    });

    if (predictionType) {
      return enriched[0] ?? null;
    }
    return enriched.find((item) => item.predictionType === "fullTimeResult") ?? enriched[0] ?? null;
  }

  async predictions(id: string, predictionType?: string, line?: number, includeMarketAnalysis = false) {
    const lineNormalized = line !== undefined && Number.isFinite(line) ? Number(line.toFixed(2)) : undefined;
    return this.predictionsService.listByMatch(id, {
      predictionType,
      line: lineNormalized,
      includeMarketAnalysis
    });
  }

  async commentary(id: string, includeMarketAnalysis = false) {
    const prediction = await this.predictions(id, undefined, undefined, includeMarketAnalysis);
    const primary =
      prediction.find((item) => item.predictionType === "fullTimeResult") ??
      prediction.find((item) => item.predictionType === "bothTeamsToScore") ??
      prediction[0];
    return primary?.commentary ?? null;
  }
}
