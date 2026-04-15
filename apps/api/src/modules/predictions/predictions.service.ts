import { Injectable } from "@nestjs/common";
import { MatchStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { OddsService } from "../odds/odds.service";
import { PredictionSportStrategyRegistry } from "./sport-strategies/prediction-sport-strategy.registry";

type ListPredictionsParams = {
  status?: string;
  sport?: string;
  predictionType?: string;
  line?: number;
  take?: number;
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
            sport: { code: string };
            status: MatchStatus;
            matchDateTimeUTC: Date;
            homeScore: number | null;
            awayScore: number | null;
            halfTimeHomeScore: number | null;
            halfTimeAwayScore: number | null;
            homeTeam: { name: string };
            awayTeam: { name: string };
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
          include: { match: { include: { sport: true, homeTeam: true, awayTeam: true } } },
          take: Math.max(take * 2, 100)
        }),
        12000
      );
    } catch {
      const stale = await this.cache.get<unknown[]>(stableCacheKey);
      if (stale) {
        await this.cache.set(cacheKey, stale, 12, ["predictions", "market-analysis"]);
        return stale;
      }
      return [];
    }

    const expanded = data.flatMap((item) => {
      const safeUpdatedAt =
        item.updatedAt instanceof Date && Number.isFinite(item.updatedAt.getTime()) ? item.updatedAt : new Date();
      const matchDateTime =
        item.match.matchDateTimeUTC instanceof Date && Number.isFinite(item.match.matchDateTimeUTC.getTime())
          ? item.match.matchDateTimeUTC
          : new Date(safeUpdatedAt.getTime() + 2 * 60 * 60 * 1000);

      // Defensive guard for partially broken data rows in production.
      if (!item.match?.homeTeam?.name || !item.match?.awayTeam?.name) {
        return [];
      }

      try {
        return this.predictionStrategyRegistry.forSport(item.match.sport?.code).expand({
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
            homeTeam: { name: item.match.homeTeam.name },
            awayTeam: { name: item.match.awayTeam.name },
            matchDateTimeUTC: matchDateTime,
            status: item.match.status,
            homeScore: item.match.homeScore,
            awayScore: item.match.awayScore,
            halfTimeHomeScore: item.match.halfTimeHomeScore,
            halfTimeAwayScore: item.match.halfTimeAwayScore
          }
        });
      } catch {
        return [];
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
