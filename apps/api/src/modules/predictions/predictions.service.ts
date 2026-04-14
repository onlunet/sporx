import { Injectable } from "@nestjs/common";
import { MatchStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { expandPredictionMarkets } from "./prediction-markets.util";
import { OddsService } from "../odds/odds.service";

type ListPredictionsParams = {
  status?: string;
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
  const defaultTake = hasExplicitStatus ? 250 : 120;
  if (input === undefined || !Number.isFinite(input)) {
    return defaultTake;
  }
  return Math.max(1, Math.min(500, Math.trunc(input)));
}

@Injectable()
export class PredictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly oddsService: OddsService
  ) {}

  async list(params?: ListPredictionsParams) {
    const statuses = parseStatusFilter(params?.status);
    const effectiveStatuses = statuses ?? [MatchStatus.scheduled, MatchStatus.live];
    const predictionType = parsePredictionType(params?.predictionType);
    const line = parseLine(params?.line);
    const take = parseTake(params?.take, statuses !== undefined);
    const includeMarketAnalysis = params?.includeMarketAnalysis === true;
    const statusKey = effectiveStatuses.join("|");
    const typeKey = predictionType ?? "all";
    const lineKey = line === undefined ? "all" : String(line);
    const takeKey = String(take);
    const analysisKey = includeMarketAnalysis ? "market" : "nomarket";
    const cacheKey = `predictions:list:v7:${statusKey}:${typeKey}:${lineKey}:${takeKey}:${analysisKey}`;
    const cached = await this.cache.get<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const data = await this.prisma.prediction.findMany({
      where: { match: { status: { in: effectiveStatuses } } },
      orderBy: { createdAt: "desc" },
      include: { match: { include: { homeTeam: true, awayTeam: true } } },
      take
    });

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
        return expandPredictionMarkets({
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
    const enriched = await this.oddsService
      .attachMarketAnalysis(lineFiltered, includeMarketAnalysis, line)
      .catch(() => lineFiltered);

    await this.cache.set(cacheKey, enriched, 20, ["predictions", "market-analysis"]);
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
