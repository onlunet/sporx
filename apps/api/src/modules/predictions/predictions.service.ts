import { Injectable } from "@nestjs/common";
import { MatchStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { OddsService } from "../odds/odds.service";
import { ExpandedPredictionItem } from "./prediction-markets.util";
import { PredictionSportStrategyRegistry } from "./sport-strategies/prediction-sport-strategy.registry";

type ListPredictionsParams = {
  status?: string;
  sport?: string;
  predictionType?: string;
  line?: number;
  take?: number;
  includeMarketAnalysis?: boolean;
};

type ListByMatchParams = {
  predictionType?: string;
  line?: number;
  includeMarketAnalysis?: boolean;
};

const MATCH_STATUS_SET = new Set<MatchStatus>([
  MatchStatus.scheduled,
  MatchStatus.live,
  MatchStatus.finished,
  MatchStatus.postponed,
  MatchStatus.cancelled
]);

const PREDICTION_TYPE_SET = new Set([
  "fullTimeResult",
  "firstHalfResult",
  "halfTimeFullTime",
  "bothTeamsToScore",
  "totalGoalsOverUnder",
  "correctScore",
  "goalRange",
  "firstHalfGoals",
  "secondHalfGoals"
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

function parsePredictionType(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim();
  return PREDICTION_TYPE_SET.has(normalized) ? normalized : undefined;
}

function parseLine(input?: number) {
  if (input === undefined) {
    return undefined;
  }
  if (!Number.isFinite(input)) {
    return undefined;
  }
  return Number(input.toFixed(2));
}

function parseTake(input: number | undefined, hasExplicitStatus: boolean) {
  const defaultTake = hasExplicitStatus ? 120 : 80;
  if (input === undefined || !Number.isFinite(input)) {
    return defaultTake;
  }
  return Math.max(1, Math.min(300, Math.trunc(input)));
}

function parseSportFilter(input?: string): "football" | "basketball" | undefined {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "football" || normalized === "soccer") {
    return "football";
  }
  if (normalized === "basketball" || normalized === "basket" || normalized === "nba") {
    return "basketball";
  }
  return undefined;
}

function safeTeamName(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function safeLeague(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" ? record.name : "";
  const code = typeof record.code === "string" ? record.code : null;
  if (!id || !name) {
    return undefined;
  }
  return { id, name, code };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asFinite(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function normalizeProbabilities(
  probabilitiesRaw: unknown,
  calibratedRaw: unknown,
  rawRaw: unknown
): {
  predictionType: ExpandedPredictionItem["predictionType"];
  marketKey: string;
  probabilities: Record<string, number>;
} {
  const sources = [probabilitiesRaw, calibratedRaw, rawRaw];
  for (const source of sources) {
    const record = asRecord(source);
    if (!record) {
      continue;
    }
    const home = asFinite(record.home);
    const draw = asFinite(record.draw);
    const away = asFinite(record.away);
    if (home !== undefined && draw !== undefined && away !== undefined) {
      const sum = Math.max(0.0001, home + draw + away);
      const probabilities: Record<string, number> = {
        home: Number((home / sum).toFixed(4)),
        draw: Number((draw / sum).toFixed(4)),
        away: Number((away / sum).toFixed(4))
      };
      return {
        predictionType: "fullTimeResult" as const,
        marketKey: "fullTimeResult:1x2",
        probabilities
      };
    }

    const yes = asFinite(record.yes);
    const no = asFinite(record.no);
    if (yes !== undefined && no !== undefined) {
      const sum = Math.max(0.0001, yes + no);
      const probabilities: Record<string, number> = {
        yes: Number((yes / sum).toFixed(4)),
        no: Number((no / sum).toFixed(4))
      };
      return {
        predictionType: "bothTeamsToScore" as const,
        marketKey: "bothTeamsToScore:yes-no",
        probabilities
      };
    }

    const over = asFinite(record.over);
    const under = asFinite(record.under);
    if (over !== undefined && under !== undefined) {
      const sum = Math.max(0.0001, over + under);
      const probabilities: Record<string, number> = {
        over: Number((over / sum).toFixed(4)),
        under: Number((under / sum).toFixed(4))
      };
      return {
        predictionType: "totalGoalsOverUnder" as const,
        marketKey: "totalGoalsOverUnder:line",
        probabilities
      };
    }
  }

  const probabilities: Record<string, number> = {
    home: 0.34,
    draw: 0.33,
    away: 0.33
  };
  return {
    predictionType: "fullTimeResult" as const,
    marketKey: "fullTimeResult:1x2",
    probabilities
  };
}

function normalizeRiskFlags(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }
      const code = typeof record.code === "string" && record.code.length > 0 ? record.code : "UNKNOWN";
      const message = typeof record.message === "string" && record.message.length > 0 ? record.message : "Risk sinyali";
      const severityRaw = typeof record.severity === "string" ? record.severity : "unknown";
      const severity =
        severityRaw === "low" || severityRaw === "medium" || severityRaw === "high" || severityRaw === "critical"
          ? severityRaw
          : "unknown";
      return { code, severity, message };
    })
    .filter((item): item is { code: string; severity: "low" | "medium" | "high" | "critical" | "unknown"; message: string } => Boolean(item));
}

function toMatchStatus(value: unknown): MatchStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === MatchStatus.live) {
    return MatchStatus.live;
  }
  if (normalized === MatchStatus.finished) {
    return MatchStatus.finished;
  }
  if (normalized === MatchStatus.postponed) {
    return MatchStatus.postponed;
  }
  if (normalized === MatchStatus.cancelled) {
    return MatchStatus.cancelled;
  }
  return MatchStatus.scheduled;
}

const PREDICTION_MATCH_SELECT = {
  status: true,
  matchDateTimeUTC: true,
  homeScore: true,
  awayScore: true,
  homeTeam: { select: { name: true } },
  awayTeam: { select: { name: true } },
  league: { select: { id: true, name: true, code: true } },
  sport: { select: { code: true } }
} as const;

function buildFallbackExpandedItem(input: {
  matchId: string;
  modelVersionId: string | null;
  probabilities: unknown;
  calibratedProbabilities: unknown;
  rawProbabilities: unknown;
  expectedScore: unknown;
  confidenceScore: number;
  summary: string;
  riskFlags: unknown;
  avoidReason: string | null;
  updatedAt: Date;
  homeTeam: string;
  awayTeam: string;
  leagueId?: string;
  leagueName?: string;
  leagueCode?: string | null;
  matchDateTimeUTC: Date;
  status: MatchStatus;
  homeScore?: number | null;
  awayScore?: number | null;
  halfTimeHomeScore?: number | null;
  halfTimeAwayScore?: number | null;
}) {
  const normalized = normalizeProbabilities(input.probabilities, input.calibratedProbabilities, input.rawProbabilities);
  const expected = asRecord(input.expectedScore);
  const expectedHome = asFinite(expected?.home) ?? 1.25;
  const expectedAway = asFinite(expected?.away) ?? 1.05;

  const item: ExpandedPredictionItem = {
    matchId: input.matchId,
    modelVersionId: input.modelVersionId,
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    leagueCode: input.leagueCode ?? undefined,
    predictionType: normalized.predictionType,
    marketKey: normalized.marketKey,
    probabilities: normalized.probabilities,
    expectedScore: { home: expectedHome, away: expectedAway },
    supportingSignals: [],
    contradictionSignals: [],
    riskFlags: normalizeRiskFlags(input.riskFlags),
    confidenceScore: Number.isFinite(input.confidenceScore) ? input.confidenceScore : 0.45,
    summary: input.summary || `${input.homeTeam} - ${input.awayTeam} maci icin fallback tahmin uretildi.`,
    avoidReason: input.avoidReason,
    updatedAt: input.updatedAt.toISOString(),
    matchStatus: input.status,
    homeScore: input.homeScore ?? null,
    awayScore: input.awayScore ?? null,
    halfTimeHomeScore: input.halfTimeHomeScore ?? null,
    halfTimeAwayScore: input.halfTimeAwayScore ?? null,
    isPlayed: input.status === MatchStatus.finished,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    matchDateTimeUTC: input.matchDateTimeUTC.toISOString(),
    commentary: {
      shortComment: `${input.homeTeam} - ${input.awayTeam} maci icin temel tahmin.`,
      detailedComment: "Ham model verisi normalize edilerek gosterime uygun hale getirildi.",
      expertComment: "Bu kayitta tam market ayrisimi olmadigi icin temel olasiliklar kullanilmistir.",
      confidenceNote: "Veri kalitesi sinirli olabilir; guncel sinyallerle birlikte degerlendirin."
    }
  };
  return item;
}

async function queryWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`query_timeout_${timeoutMs}`));
      }, timeoutMs);
    })
  ]);
}

@Injectable()
export class PredictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly oddsService: OddsService,
    private readonly predictionStrategyRegistry: PredictionSportStrategyRegistry
  ) {}

  async list(params?: ListPredictionsParams) {
    const statuses = parseStatusFilter(params?.status);
    const sportCode = parseSportFilter(params?.sport);
    const effectiveStatuses = statuses ?? [MatchStatus.scheduled, MatchStatus.live];
    const predictionType = parsePredictionType(params?.predictionType);
    const line = parseLine(params?.line);
    const take = parseTake(params?.take, statuses !== undefined);
    const includeMarketAnalysis = params?.includeMarketAnalysis === true;
    const statusKey = effectiveStatuses.join("|");
    const typeKey = predictionType ?? "all";
    const sportKey = sportCode ?? "all";
    const lineKey = line === undefined ? "all" : String(line);
    const takeKey = String(take);
    const analysisKey = includeMarketAnalysis ? "market" : "nomarket";
    const cacheKey = `predictions:list:v8:${sportKey}:${statusKey}:${typeKey}:${lineKey}:${takeKey}:${analysisKey}`;
    const stableCacheKey = `${cacheKey}:stable`;
    const cached = await this.cache.get<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

	    let data:
	      | Array<{
          matchId: string;
          modelVersionId: string | null;
          probabilities: unknown;
          calibratedProbabilities: unknown;
          rawProbabilities: unknown;
          expectedScore: unknown;
          confidenceScore: number;
          summary: string;
          riskFlags: unknown;
          avoidReason: string | null;
          updatedAt: Date;
          createdAt: Date;
	          match: {
	            sport: { code: string } | null;
	            status: MatchStatus;
	            matchDateTimeUTC: Date;
	            homeScore: number | null;
	            awayScore: number | null;
	            homeTeam: { name: string };
	            awayTeam: { name: string };
	            league: { id: string; name: string; code: string | null } | null;
	          };
	        }>
      | [] = [];

    try {
      const targetTake = Math.max(take, 60);
      const relevantMatches =
        effectiveStatuses.length === 1
          ? await queryWithTimeout(
              this.prisma.match.findMany({
                where: {
                  status: { in: effectiveStatuses },
                  ...(sportCode ? { sport: { code: sportCode } } : {})
                },
                select: { id: true, matchDateTimeUTC: true },
                orderBy: { matchDateTimeUTC: "desc" },
                take: targetTake
              }),
              12000
            )
          : (
              await Promise.all(
                effectiveStatuses.map(async (status) => {
                  try {
                    return await queryWithTimeout(
                      this.prisma.match.findMany({
                        where: {
                          status,
                          ...(sportCode ? { sport: { code: sportCode } } : {})
                        },
                        select: { id: true, matchDateTimeUTC: true },
                        orderBy: { matchDateTimeUTC: "desc" },
                        take: Math.max(Math.ceil(targetTake / effectiveStatuses.length) + 24, 36)
                      }),
                      9000
                    );
                  } catch {
                    return [] as Array<{ id: string; matchDateTimeUTC: Date }>;
                  }
                })
              )
            )
              .flat()
              .sort((left, right) => right.matchDateTimeUTC.getTime() - left.matchDateTimeUTC.getTime())
              .slice(0, targetTake);

      if (relevantMatches.length === 0) {
        await this.cache.set(cacheKey, [], 20, ["predictions", "market-analysis"]);
        return [];
      }

      const matchIds = relevantMatches.map((item) => item.id);
	      data = await queryWithTimeout(
	        this.prisma.prediction.findMany({
	          where: { matchId: { in: matchIds } },
	          orderBy: { createdAt: "desc" },
	          include: { match: { select: PREDICTION_MATCH_SELECT } },
	          take: Math.max(take * 2, 100)
	        }),
	        12000
	      );

      if (data.length === 0) {
	        data = await queryWithTimeout(
	          this.prisma.prediction.findMany({
	            where: {
	              match: {
	                status: { in: effectiveStatuses },
	                ...(sportCode ? { sport: { code: sportCode } } : {})
	              }
	            },
	            orderBy: { updatedAt: "desc" },
	            include: { match: { select: PREDICTION_MATCH_SELECT } },
	            take: Math.max(take * 3, 120)
	          }),
	          12000
	        ).catch(() => []);
      }
    } catch {
      const stale = await this.cache.get<unknown[]>(stableCacheKey);
      if (stale) {
        await this.cache.set(cacheKey, stale, 12, ["predictions", "market-analysis"]);
        return stale;
      }
      return [];
    }

    const expanded = data.flatMap((item) => {
      const matchRecord = (item.match as Record<string, unknown> | null) ?? null;
      const safeUpdatedAt =
        item.updatedAt instanceof Date && Number.isFinite(item.updatedAt.getTime()) ? item.updatedAt : new Date();
      const rawMatchDateTime = matchRecord?.matchDateTimeUTC;
      const matchDateTime =
        rawMatchDateTime instanceof Date && Number.isFinite(rawMatchDateTime.getTime())
          ? rawMatchDateTime
          : new Date(safeUpdatedAt.getTime() + 2 * 60 * 60 * 1000);
      const sportCodeRaw = (matchRecord?.sport as Record<string, unknown> | null)?.code;
      const sportCode = typeof sportCodeRaw === "string" && sportCodeRaw.trim().length > 0 ? sportCodeRaw : "football";
      const homeTeamName = safeTeamName((matchRecord?.homeTeam as Record<string, unknown> | null)?.name, "Bilinmeyen Ev Takim");
      const awayTeamName = safeTeamName((matchRecord?.awayTeam as Record<string, unknown> | null)?.name, "Bilinmeyen Deplasman Takim");
      const league = safeLeague(matchRecord?.league);
      const matchStatus = toMatchStatus(matchRecord?.status);

      try {
        return this.predictionStrategyRegistry.forSport(sportCode).expand({
          matchId: item.matchId,
          modelVersionId: item.modelVersionId,
          probabilities: item.probabilities,
          calibratedProbabilities: item.calibratedProbabilities,
          rawProbabilities: item.rawProbabilities,
          expectedScore: item.expectedScore,
          confidenceScore: item.confidenceScore,
          summary: item.summary,
          riskFlags: item.riskFlags,
          avoidReason: item.avoidReason,
          updatedAt: safeUpdatedAt,
          match: {
            homeTeam: { name: homeTeamName },
            awayTeam: { name: awayTeamName },
            league,
            matchDateTimeUTC: matchDateTime,
            status: matchStatus,
            homeScore: typeof matchRecord?.homeScore === "number" ? matchRecord.homeScore : null,
            awayScore: typeof matchRecord?.awayScore === "number" ? matchRecord.awayScore : null,
            halfTimeHomeScore: typeof matchRecord?.halfTimeHomeScore === "number" ? matchRecord.halfTimeHomeScore : null,
            halfTimeAwayScore: typeof matchRecord?.halfTimeAwayScore === "number" ? matchRecord.halfTimeAwayScore : null,
            q1HomeScore: typeof matchRecord?.q1HomeScore === "number" ? matchRecord.q1HomeScore : null,
            q1AwayScore: typeof matchRecord?.q1AwayScore === "number" ? matchRecord.q1AwayScore : null,
            q2HomeScore: typeof matchRecord?.q2HomeScore === "number" ? matchRecord.q2HomeScore : null,
            q2AwayScore: typeof matchRecord?.q2AwayScore === "number" ? matchRecord.q2AwayScore : null,
            q3HomeScore: typeof matchRecord?.q3HomeScore === "number" ? matchRecord.q3HomeScore : null,
            q3AwayScore: typeof matchRecord?.q3AwayScore === "number" ? matchRecord.q3AwayScore : null,
            q4HomeScore: typeof matchRecord?.q4HomeScore === "number" ? matchRecord.q4HomeScore : null,
            q4AwayScore: typeof matchRecord?.q4AwayScore === "number" ? matchRecord.q4AwayScore : null
          }
        });
      } catch {
        return [
          buildFallbackExpandedItem({
            matchId: item.matchId,
            modelVersionId: item.modelVersionId,
            probabilities: item.probabilities,
            calibratedProbabilities: item.calibratedProbabilities,
            rawProbabilities: item.rawProbabilities,
            expectedScore: item.expectedScore,
            confidenceScore: item.confidenceScore,
            summary: item.summary,
            riskFlags: item.riskFlags,
            avoidReason: item.avoidReason,
            updatedAt: safeUpdatedAt,
            homeTeam: homeTeamName,
            awayTeam: awayTeamName,
            leagueId: league?.id,
            leagueName: league?.name,
            leagueCode: league?.code,
            matchDateTimeUTC: matchDateTime,
            status: matchStatus,
            homeScore: typeof matchRecord?.homeScore === "number" ? matchRecord.homeScore : null,
            awayScore: typeof matchRecord?.awayScore === "number" ? matchRecord.awayScore : null,
            halfTimeHomeScore: typeof matchRecord?.halfTimeHomeScore === "number" ? matchRecord.halfTimeHomeScore : null,
            halfTimeAwayScore: typeof matchRecord?.halfTimeAwayScore === "number" ? matchRecord.halfTimeAwayScore : null
          })
        ];
      }
    });

    const payload = predictionType
      ? expanded.filter((item) => item.predictionType === predictionType)
      : expanded;

    const lineFiltered = line === undefined ? payload : payload.filter((item) => item.line === line);
    lineFiltered.sort((left, right) => {
      const leftTs = left.matchDateTimeUTC ? Date.parse(left.matchDateTimeUTC) : 0;
      const rightTs = right.matchDateTimeUTC ? Date.parse(right.matchDateTimeUTC) : 0;
      return rightTs - leftTs;
    });
    const uniqueByMarket = new Map<string, (typeof lineFiltered)[number]>();
    for (const item of lineFiltered) {
      const dedupeKey = [
        item.matchId,
        item.predictionType,
        item.line === undefined ? "na" : String(item.line),
        item.marketKey ?? "market",
        item.selectionLabel ?? "selection"
      ].join("|");
      if (!uniqueByMarket.has(dedupeKey)) {
        uniqueByMarket.set(dedupeKey, item);
      }
    }
    const deduped = Array.from(uniqueByMarket.values());
    const enriched = await this.oddsService
      .attachMarketAnalysis(deduped, includeMarketAnalysis, line)
      .catch(() => deduped);

    await this.cache.set(cacheKey, enriched, 20, ["predictions", "market-analysis"]);
    await this.cache.set(stableCacheKey, enriched, 300, ["predictions", "market-analysis"]);
    return enriched;
  }

  async listByMatch(matchId: string, params?: ListByMatchParams) {
    const predictionType = parsePredictionType(params?.predictionType);
    const line = parseLine(params?.line);
    const includeMarketAnalysis = params?.includeMarketAnalysis === true;

    const rows = await this.prisma.prediction.findMany({
      where: { matchId },
      include: { match: { select: PREDICTION_MATCH_SELECT } },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
      take: 5
    });
    if (rows.length === 0) {
      return [];
    }

    const expanded = rows.flatMap((row) => {
      const matchRecord = (row.match as Record<string, unknown> | null) ?? null;
      const rawMatchDateTime = matchRecord?.matchDateTimeUTC;
      const safeUpdatedAt =
        row.updatedAt instanceof Date && Number.isFinite(row.updatedAt.getTime()) ? row.updatedAt : new Date();
      const matchDateTime =
        rawMatchDateTime instanceof Date && Number.isFinite(rawMatchDateTime.getTime())
          ? rawMatchDateTime
          : new Date(safeUpdatedAt.getTime() + 2 * 60 * 60 * 1000);
      const sportCodeRaw = (matchRecord?.sport as Record<string, unknown> | null)?.code;
      const sportCode = typeof sportCodeRaw === "string" && sportCodeRaw.trim().length > 0 ? sportCodeRaw : "football";
      const homeTeamName = safeTeamName((matchRecord?.homeTeam as Record<string, unknown> | null)?.name, "Bilinmeyen Ev Takim");
      const awayTeamName = safeTeamName((matchRecord?.awayTeam as Record<string, unknown> | null)?.name, "Bilinmeyen Deplasman Takim");
      const league = safeLeague(matchRecord?.league);
      const status = toMatchStatus(matchRecord?.status);

      try {
        const strategy = this.predictionStrategyRegistry.forSport(sportCode);

        return strategy.expand({
          matchId: row.matchId,
          modelVersionId: row.modelVersionId,
          probabilities: row.probabilities,
          calibratedProbabilities: row.calibratedProbabilities,
          rawProbabilities: row.rawProbabilities,
          expectedScore: row.expectedScore,
          confidenceScore: row.confidenceScore,
          summary: row.summary,
          riskFlags: row.riskFlags,
          avoidReason: row.avoidReason,
          updatedAt: safeUpdatedAt,
          match: {
            homeTeam: {
              name: homeTeamName
            },
            awayTeam: {
              name: awayTeamName
            },
            league,
            matchDateTimeUTC: matchDateTime,
            status,
            homeScore: typeof matchRecord?.homeScore === "number" ? matchRecord.homeScore : null,
            awayScore: typeof matchRecord?.awayScore === "number" ? matchRecord.awayScore : null,
            halfTimeHomeScore: typeof matchRecord?.halfTimeHomeScore === "number" ? matchRecord.halfTimeHomeScore : null,
            halfTimeAwayScore: typeof matchRecord?.halfTimeAwayScore === "number" ? matchRecord.halfTimeAwayScore : null,
            q1HomeScore: typeof matchRecord?.q1HomeScore === "number" ? matchRecord.q1HomeScore : null,
            q1AwayScore: typeof matchRecord?.q1AwayScore === "number" ? matchRecord.q1AwayScore : null,
            q2HomeScore: typeof matchRecord?.q2HomeScore === "number" ? matchRecord.q2HomeScore : null,
            q2AwayScore: typeof matchRecord?.q2AwayScore === "number" ? matchRecord.q2AwayScore : null,
            q3HomeScore: typeof matchRecord?.q3HomeScore === "number" ? matchRecord.q3HomeScore : null,
            q3AwayScore: typeof matchRecord?.q3AwayScore === "number" ? matchRecord.q3AwayScore : null,
            q4HomeScore: typeof matchRecord?.q4HomeScore === "number" ? matchRecord.q4HomeScore : null,
            q4AwayScore: typeof matchRecord?.q4AwayScore === "number" ? matchRecord.q4AwayScore : null
          }
        });
      } catch {
        return [
          buildFallbackExpandedItem({
            matchId: row.matchId,
            modelVersionId: row.modelVersionId,
            probabilities: row.probabilities,
            calibratedProbabilities: row.calibratedProbabilities,
            rawProbabilities: row.rawProbabilities,
            expectedScore: row.expectedScore,
            confidenceScore: row.confidenceScore,
            summary: row.summary,
            riskFlags: row.riskFlags,
            avoidReason: row.avoidReason,
            updatedAt: safeUpdatedAt,
            homeTeam: homeTeamName,
            awayTeam: awayTeamName,
            leagueId: league?.id,
            leagueName: league?.name,
            leagueCode: league?.code,
            matchDateTimeUTC: matchDateTime,
            status,
            homeScore: typeof matchRecord?.homeScore === "number" ? matchRecord.homeScore : null,
            awayScore: typeof matchRecord?.awayScore === "number" ? matchRecord.awayScore : null,
            halfTimeHomeScore: typeof matchRecord?.halfTimeHomeScore === "number" ? matchRecord.halfTimeHomeScore : null,
            halfTimeAwayScore: typeof matchRecord?.halfTimeAwayScore === "number" ? matchRecord.halfTimeAwayScore : null
          })
        ];
      }
    });

    const filteredByType = predictionType
      ? expanded.filter((item) => item.predictionType === predictionType)
      : expanded;
    const lineFiltered = line === undefined ? filteredByType : filteredByType.filter((item) => item.line === line);

    const uniqueByMarket = new Map<string, (typeof lineFiltered)[number]>();
    for (const item of lineFiltered) {
      const dedupeKey = [
        item.matchId,
        item.predictionType,
        item.line === undefined ? "na" : String(item.line),
        item.marketKey ?? "market",
        item.selectionLabel ?? "selection"
      ].join("|");
      if (!uniqueByMarket.has(dedupeKey)) {
        uniqueByMarket.set(dedupeKey, item);
      }
    }

    const deduped = Array.from(uniqueByMarket.values());
    return this.oddsService.attachMarketAnalysis(deduped, includeMarketAnalysis, line).catch(() => deduped);
  }

  highConfidence() {
    return this.prisma.prediction.findMany({
      where: {
        confidenceScore: { gte: 0.7 },
        isLowConfidence: false
      },
      orderBy: { confidenceScore: "desc" },
      take: 50
    });
  }
}
