import { Injectable, NotFoundException } from "@nestjs/common";
import { MatchStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { expandPredictionMarkets } from "../predictions/prediction-markets.util";
import { OddsService } from "../odds/odds.service";

type ListMatchesParams = {
  status?: string;
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
    return 100;
  }
  return Math.max(1, Math.min(500, Math.trunc(take ?? 100)));
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
    private readonly oddsService: OddsService
  ) {}

  async list(params?: ListMatchesParams) {
    const statuses = parseStatusFilter(params?.status);
    const take = normalizeTake(params?.take);
    const statusKey = statuses?.join("|") ?? "all";
    const cacheKey = `matches:list:v2:${statusKey}:${take}`;
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

    try {
      matches = await queryWithTimeout(
        this.prisma.match.findMany({
          where: statuses ? { status: { in: statuses } } : undefined,
          orderBy: { matchDateTimeUTC: "desc" },
          select: {
            id: true,
            matchDateTimeUTC: true,
            status: true,
            homeScore: true,
            awayScore: true,
            homeTeamId: true,
            awayTeamId: true,
            leagueId: true
          },
          take
        }),
        9000
      );
    } catch {
      await this.cache.set(cacheKey, [], 20, ["matches"]);
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
    return data;
  }

  async getById(id: string) {
    const match = await this.prisma.match.findUnique({
      where: { id },
      include: { homeTeam: true, awayTeam: true, league: true, season: true }
    });

    if (!match) {
      throw new NotFoundException("Match not found");
    }

    return match;
  }

  events(id: string) {
    return this.prisma.matchEvent.findMany({ where: { matchId: id }, orderBy: { minute: "asc" } });
  }

  stats(id: string) {
    return this.prisma.teamStat.findMany({ where: { matchId: id }, include: { team: true } });
  }

  async prediction(id: string, predictionType?: string, line?: number, includeMarketAnalysis = false) {
    const prediction = await this.prisma.prediction.findUnique({
      where: { matchId: id },
      include: {
        match: {
          include: {
            homeTeam: true,
            awayTeam: true
          }
        }
      }
    });

    if (!prediction) {
      return null;
    }

    const expanded = expandPredictionMarkets({
      matchId: prediction.matchId,
      modelVersionId: prediction.modelVersionId,
      probabilities: prediction.probabilities,
      calibratedProbabilities: prediction.calibratedProbabilities,
      rawProbabilities: prediction.rawProbabilities,
      expectedScore: prediction.expectedScore,
      confidenceScore: prediction.confidenceScore,
      summary: prediction.summary,
      riskFlags: prediction.riskFlags,
      avoidReason: prediction.avoidReason,
      updatedAt: prediction.updatedAt,
      match: {
        homeTeam: { name: prediction.match.homeTeam.name },
        awayTeam: { name: prediction.match.awayTeam.name },
        matchDateTimeUTC: prediction.match.matchDateTimeUTC,
        status: prediction.match.status,
        homeScore: prediction.match.homeScore,
        awayScore: prediction.match.awayScore,
        halfTimeHomeScore: prediction.match.halfTimeHomeScore,
        halfTimeAwayScore: prediction.match.halfTimeAwayScore
      }
    });

    const lineNormalized = line !== undefined && Number.isFinite(line) ? Number(line.toFixed(2)) : undefined;
    const filteredByType = predictionType
      ? expanded.filter((item) => item.predictionType === predictionType)
      : expanded;
    const filtered = lineNormalized === undefined ? filteredByType : filteredByType.filter((item) => item.line === lineNormalized);
    const enriched = await this.oddsService.attachMarketAnalysis(filtered, includeMarketAnalysis, lineNormalized);

    if (predictionType) {
      return enriched[0] ?? null;
    }
    return enriched.find((item) => item.predictionType === "fullTimeResult") ?? enriched[0] ?? null;
  }

  async predictions(id: string, predictionType?: string, line?: number, includeMarketAnalysis = false) {
    const prediction = await this.prisma.prediction.findUnique({
      where: { matchId: id },
      include: {
        match: {
          include: {
            homeTeam: true,
            awayTeam: true
          }
        }
      }
    });

    if (!prediction) {
      return [];
    }

    const expanded = expandPredictionMarkets({
      matchId: prediction.matchId,
      modelVersionId: prediction.modelVersionId,
      probabilities: prediction.probabilities,
      calibratedProbabilities: prediction.calibratedProbabilities,
      rawProbabilities: prediction.rawProbabilities,
      expectedScore: prediction.expectedScore,
      confidenceScore: prediction.confidenceScore,
      summary: prediction.summary,
      riskFlags: prediction.riskFlags,
      avoidReason: prediction.avoidReason,
      updatedAt: prediction.updatedAt,
      match: {
        homeTeam: { name: prediction.match.homeTeam.name },
        awayTeam: { name: prediction.match.awayTeam.name },
        matchDateTimeUTC: prediction.match.matchDateTimeUTC,
        status: prediction.match.status,
        homeScore: prediction.match.homeScore,
        awayScore: prediction.match.awayScore,
        halfTimeHomeScore: prediction.match.halfTimeHomeScore,
        halfTimeAwayScore: prediction.match.halfTimeAwayScore
      }
    });

    const lineNormalized = line !== undefined && Number.isFinite(line) ? Number(line.toFixed(2)) : undefined;
    const filteredByType = predictionType
      ? expanded.filter((item) => item.predictionType === predictionType)
      : expanded;
    const filtered = lineNormalized === undefined ? filteredByType : filteredByType.filter((item) => item.line === lineNormalized);
    return this.oddsService.attachMarketAnalysis(filtered, includeMarketAnalysis, lineNormalized);
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
