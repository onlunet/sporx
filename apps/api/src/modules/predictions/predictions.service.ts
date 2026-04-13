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

@Injectable()
export class PredictionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly oddsService: OddsService
  ) {}

  async list(params?: ListPredictionsParams) {
    const statuses = parseStatusFilter(params?.status);
    const predictionType = parsePredictionType(params?.predictionType);
    const line = parseLine(params?.line);
    const includeMarketAnalysis = params?.includeMarketAnalysis === true;
    const statusKey = statuses?.join("|") ?? "all";
    const typeKey = predictionType ?? "all";
    const lineKey = line === undefined ? "all" : String(line);
    const analysisKey = includeMarketAnalysis ? "market" : "nomarket";
    const cacheKey = `predictions:list:v6:${statusKey}:${typeKey}:${lineKey}:${analysisKey}`;
    const cached = await this.cache.get<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const data = await this.prisma.prediction.findMany({
      where: statuses ? { match: { status: { in: statuses } } } : undefined,
      orderBy: [{ match: { matchDateTimeUTC: "desc" } }, { createdAt: "desc" }],
      include: { match: { include: { homeTeam: true, awayTeam: true } } },
      take: 500
    });

    const expanded = data.flatMap((item) =>
      expandPredictionMarkets({
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
        updatedAt: item.updatedAt,
        match: {
          homeTeam: { name: item.match.homeTeam.name },
          awayTeam: { name: item.match.awayTeam.name },
          matchDateTimeUTC: item.match.matchDateTimeUTC,
          status: item.match.status,
          homeScore: item.match.homeScore,
          awayScore: item.match.awayScore,
          halfTimeHomeScore: item.match.halfTimeHomeScore,
          halfTimeAwayScore: item.match.halfTimeAwayScore
        }
      })
    );

    const payload = predictionType
      ? expanded.filter((item) => item.predictionType === predictionType)
      : expanded;

    const lineFiltered = line === undefined ? payload : payload.filter((item) => item.line === line);
    const enriched = await this.oddsService.attachMarketAnalysis(lineFiltered, includeMarketAnalysis, line);

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
