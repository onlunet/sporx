import { Injectable, Logger } from "@nestjs/common";
import { MatchStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { FootballDataConnector, FootballDataHttpError } from "./football-data.connector";
import { TheSportsDbConnector } from "./the-sports-db.connector";
import { BallDontLieConnector } from "./ball-dont-lie.connector";
import { ApiFootballConnector } from "./api-football.connector";
import { ApiBasketballConnector } from "./api-basketball.connector";
import { ApiNbaConnector } from "./api-nba.connector";
import { SportApiConnector } from "./sport-api.connector";
import { ProvidersService } from "./providers.service";
import { OddsIngestionService } from "./odds-ingestion.service";
import { PredictionEngineService } from "../predictions/prediction-engine.service";
import { AdvancedPredictionEngineService } from "../predictions/advanced-prediction-engine.service";
import { MatchContextEnrichmentService } from "./match-context-enrichment.service";

type SyncSummary = {
  recordsRead: number;
  recordsWritten: number;
  errors: number;
  logs: Record<string, unknown>;
};

type ProviderSyncResult = {
  providerKey: string;
  recordsRead: number;
  recordsWritten: number;
  errors: number;
  details: Record<string, unknown>;
};

type ProviderRecord = {
  id: string;
  key: string;
  baseUrl: string | null;
};

type TheSportsDbTeamCandidate = {
  idTeam: string;
  strTeam: string;
  strCountry: string;
  strTeamShort: string | null;
  intFormedYear: number | null;
  strAlternate: string | null;
};

const ENRICHMENT_JOB_TYPES = ["resolveProviderAliases", "enrichTeamProfiles", "enrichMatchDetails"] as const;

type MatchSeedInput = {
  providerId: string;
  providerKey: string;
  providerMatchKey: string;
  sportCode: "football" | "basketball";
  sportName: string;
  leagueName: string;
  leagueCountry: string;
  kickoffAt: Date;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCountry: string;
  awayTeamCountry: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  homeElo?: number | null;
  awayElo?: number | null;
  form5Home?: number | null;
  form5Away?: number | null;
  refereeName?: string | null;
  dataSource: string;
};

type PredictionRiskTuningSettings = {
  lowConfidenceThreshold: number;
  infoFlagSuppressionThreshold: number;
  lowScoreBiasThreshold: number;
  lowScoreTotalGoalsThreshold: number;
  conflictBaseEloGap: number;
  conflictLeagueGoalEnvMultiplier: number;
  conflictVolatilityMultiplier: number;
  conflictOutcomeEdgeBase: number;
  conflictOutcomeEdgeVolatilityMultiplier: number;
  conflictMinCalibratedConfidence: number;
};

@Injectable()
export class ProviderIngestionService {
  private readonly logger = new Logger(ProviderIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly providersService: ProvidersService,
    private readonly footballDataConnector: FootballDataConnector,
    private readonly theSportsDbConnector: TheSportsDbConnector,
    private readonly ballDontLieConnector: BallDontLieConnector,
    private readonly apiFootballConnector: ApiFootballConnector,
    private readonly apiBasketballConnector: ApiBasketballConnector,
    private readonly apiNbaConnector: ApiNbaConnector,
    private readonly sportApiConnector: SportApiConnector,
    private readonly oddsIngestionService: OddsIngestionService,
    private readonly predictionEngine: PredictionEngineService,
    private readonly advancedPredictionEngine: AdvancedPredictionEngineService,
    private readonly matchContextEnrichment: MatchContextEnrichmentService
  ) {}

  private supportsProviderFetch(jobType: string) {
    return [
      "syncFixtures",
      "syncResults",
      "syncStandings",
      "syncLeagues",
      "syncTeams",
      "syncOddsPreMatch",
      "syncOddsLive",
      "syncOddsClosing",
      "generateMarketAnalysis",
      ...ENRICHMENT_JOB_TYPES
    ].includes(jobType);
  }

  private parseConfigInt(value: unknown, fallback: number) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private parseEnvInt(key: string, fallback: number) {
    const raw = process.env[key];
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private parseSystemSettingNumber(value: unknown, fallback: number) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value.trim());
      if (Number.isFinite(parsed)) {
        return parsed;
      }
      return fallback;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const candidate = (value as Record<string, unknown>).value;
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return candidate;
      }
      if (typeof candidate === "string") {
        const parsed = Number(candidate.trim());
        if (Number.isFinite(parsed)) {
          return parsed;
        }
      }
    }
    return fallback;
  }

  private clampNumeric(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private async loadPredictionRiskTuningSettings(): Promise<PredictionRiskTuningSettings> {
    const keys = [
      "prediction.lowConfidenceThreshold",
      "prediction.infoFlagSuppressionThreshold",
      "risk.lowScoreBias.threshold",
      "risk.lowScoreBias.totalGoalsThreshold",
      "risk.conflict.baseEloGapThreshold",
      "risk.conflict.leagueGoalEnvMultiplier",
      "risk.conflict.volatilityMultiplier",
      "risk.conflict.outcomeEdgeBase",
      "risk.conflict.outcomeEdgeVolatilityMultiplier",
      "risk.conflict.minCalibratedConfidence"
    ] as const;

    const rows = await this.prisma.systemSetting.findMany({
      where: { key: { in: [...keys] } },
      select: { key: true, value: true }
    });

    const valueMap = new Map(rows.map((row) => [row.key, row.value] as const));

    return {
      lowConfidenceThreshold: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("prediction.lowConfidenceThreshold"), 0.54),
        0.35,
        0.8
      ),
      infoFlagSuppressionThreshold: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("prediction.infoFlagSuppressionThreshold"), 0.7),
        0.5,
        0.9
      ),
      lowScoreBiasThreshold: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("risk.lowScoreBias.threshold"), 0.18),
        0.05,
        0.35
      ),
      lowScoreTotalGoalsThreshold: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("risk.lowScoreBias.totalGoalsThreshold"), 1.6),
        1.0,
        2.4
      ),
      conflictBaseEloGap: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("risk.conflict.baseEloGapThreshold"), 45),
        20,
        100
      ),
      conflictLeagueGoalEnvMultiplier: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("risk.conflict.leagueGoalEnvMultiplier"), 20),
        5,
        45
      ),
      conflictVolatilityMultiplier: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("risk.conflict.volatilityMultiplier"), 25),
        5,
        50
      ),
      conflictOutcomeEdgeBase: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("risk.conflict.outcomeEdgeBase"), 0.11),
        0.05,
        0.3
      ),
      conflictOutcomeEdgeVolatilityMultiplier: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("risk.conflict.outcomeEdgeVolatilityMultiplier"), 0.12),
        0.02,
        0.35
      ),
      conflictMinCalibratedConfidence: this.clampNumeric(
        this.parseSystemSettingNumber(valueMap.get("risk.conflict.minCalibratedConfidence"), 0.56),
        0.4,
        0.85
      )
    };
  }

  private async footballDataThrottle(
    providerKey: string,
    limitPerMinute: number,
    buffer: number,
    minIntervalMs: number
  ) {
    const effectiveLimit = Math.max(1, limitPerMinute - Math.max(0, buffer));
    let waitedMs = 0;
    let hits = 0;
    let remainingSeconds = 60;

    while (true) {
      const minuteBucket = Math.floor(Date.now() / 60000);
      const rate = await this.cache.incrementRateLimit(`${providerKey}:minute:${minuteBucket}`, 65);
      hits = rate.hits;
      remainingSeconds = rate.remainingSeconds;

      if (rate.hits <= effectiveLimit) {
        break;
      }

      const waitMs = Math.max(1000, (rate.remainingSeconds + 1) * 1000);
      waitedMs += waitMs;
      await this.sleep(waitMs);
    }

    const lastCallKey = `provider:${providerKey}:last_call_ms`;
    const nowMs = Date.now();
    const lastCallMs = await this.cache.get<number>(lastCallKey);
    if (typeof lastCallMs === "number") {
      const elapsedMs = nowMs - lastCallMs;
      if (elapsedMs < minIntervalMs) {
        const waitMs = minIntervalMs - elapsedMs;
        waitedMs += waitMs;
        await this.sleep(waitMs);
      }
    }
    await this.cache.set(lastCallKey, Date.now(), 180);

    return {
      waitedMs,
      effectiveLimit,
      hits,
      remainingSeconds
    };
  }

  private async footballDataFetchMatchesWithRetry(
    apiKey: string,
    competitionCode: string,
    dateFrom: string,
    dateTo: string,
    baseUrl: string | undefined,
    retryMax: number
  ) {
    let attempt = 0;
    let backoffMsTotal = 0;

    while (true) {
      try {
        const response = await this.footballDataConnector.fetchMatches(apiKey, competitionCode, dateFrom, dateTo, baseUrl);
        return {
          response,
          retries: attempt,
          backoffMsTotal
        };
      } catch (error) {
        const shouldRetry =
          error instanceof FootballDataHttpError &&
          error.status === 429 &&
          attempt < retryMax;

        if (!shouldRetry) {
          throw error;
        }

        const retryAfterMs =
          error.retryAfterSeconds && error.retryAfterSeconds > 0
            ? error.retryAfterSeconds * 1000
            : Math.min(45000, 10000 * (attempt + 1));

        this.logger.warn(
          `football_data rate limited for ${competitionCode}, retrying in ${retryAfterMs}ms (attempt ${attempt + 1}/${retryMax})`
        );
        backoffMsTotal += retryAfterMs;
        attempt += 1;
        await this.sleep(retryAfterMs);
      }
    }
  }

  private async footballDataFetchStandingsWithRetry(
    apiKey: string,
    competitionCode: string,
    season: string | undefined,
    baseUrl: string | undefined,
    retryMax: number
  ) {
    let attempt = 0;
    let backoffMsTotal = 0;

    while (true) {
      try {
        const response = await this.footballDataConnector.fetchStandings(
          apiKey,
          competitionCode,
          season,
          baseUrl
        );
        return {
          response,
          retries: attempt,
          backoffMsTotal
        };
      } catch (error) {
        const shouldRetry =
          error instanceof FootballDataHttpError &&
          error.status === 429 &&
          attempt < retryMax;

        if (!shouldRetry) {
          throw error;
        }

        const retryAfterMs =
          error.retryAfterSeconds && error.retryAfterSeconds > 0
            ? error.retryAfterSeconds * 1000
            : Math.min(45000, 10000 * (attempt + 1));

        this.logger.warn(
          `football_data standings rate limited for ${competitionCode}, retrying in ${retryAfterMs}ms (attempt ${attempt + 1}/${retryMax})`
        );
        backoffMsTotal += retryAfterMs;
        attempt += 1;
        await this.sleep(retryAfterMs);
      }
    }
  }

  private utcDayStart() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }

  private async dailyUsage(providerKey: string) {
    return this.prisma.apiLog.count({
      where: {
        path: { startsWith: `provider/${providerKey}/` },
        createdAt: { gte: this.utcDayStart() }
      }
    });
  }

  private async quotaGate(providerKey: string, requestedCalls: number, dailyLimit?: number) {
    if (!dailyLimit || dailyLimit <= 0) {
      return {
        allowed: true,
        used: 0,
        remaining: Number.POSITIVE_INFINITY,
        limit: dailyLimit ?? null
      };
    }

    const used = await this.dailyUsage(providerKey);
    const remaining = Math.max(0, dailyLimit - used);
    return {
      allowed: used + requestedCalls <= dailyLimit,
      used,
      remaining,
      limit: dailyLimit
    };
  }

  async sync(jobType: string, runId: string): Promise<SyncSummary> {
    if (jobType === "generatePredictions") {
      await this.normalizeStaleMatchStatuses(runId);
      return this.generatePredictions(runId);
    }

    if (jobType === "providerHealthCheck") {
      const health = await this.providersService.providerHealth();
      const healthyCount = health.filter((item) => item.status === "healthy").length;
      const degradedOrDownCount = health.length - healthyCount;

      await this.createExternalPayload("internal", runId, "provider_health_check", {
        providerCount: health.length,
        healthyCount,
        degradedOrDownCount,
        health
      });
      await this.logApiCall("provider/internal/providerHealthCheck", 200, 0, runId);

      return {
        recordsRead: health.length,
        recordsWritten: healthyCount,
        errors: degradedOrDownCount,
        logs: {
          health
        }
      };
    }

    if (!this.supportsProviderFetch(jobType)) {
      return {
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        logs: {
          message: `Job ${jobType} does not require external provider fetch`
        }
      };
    }

    if (jobType === "syncFixtures" || jobType === "syncResults") {
      await this.normalizeStaleMatchStatuses(runId);
    }

    const activeProviders = await this.providersService.listActiveApiProviders();
    const results: ProviderSyncResult[] = [];

    for (const provider of activeProviders) {
      try {
        if (provider.key === "football_data") {
          results.push(await this.syncFootballData(provider, runId, jobType));
        } else if (provider.key === "the_sports_db") {
          results.push(await this.syncTheSportsDb(provider, runId, jobType));
        } else if (provider.key === "ball_dont_lie") {
          results.push(await this.syncBallDontLie(provider, runId, jobType));
        } else if (provider.key === "api_football") {
          results.push(await this.syncApiFootball(provider, runId, jobType));
        } else if (provider.key === "api_basketball") {
          results.push(await this.syncApiBasketball(provider, runId, jobType));
        } else if (provider.key === "api_nba") {
          results.push(await this.syncApiNba(provider, runId, jobType));
        } else if (provider.key === "sportapi_ai") {
          results.push(await this.syncSportApi(provider, runId, jobType));
        } else if (provider.key === "odds_api_io") {
          const settings = await this.providersService.getProviderRuntimeSettings(provider.key);
          results.push(await this.oddsIngestionService.sync(provider, settings, runId, jobType));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown provider ingestion error";
        this.logger.error(`Provider sync failed for ${provider.key}: ${message}`);
        await this.logApiCall(`provider/${provider.key}/sync`, 500, 0, runId);
        results.push({
          providerKey: provider.key,
          recordsRead: 0,
          recordsWritten: 0,
          errors: 1,
          details: { message }
        });
      }
    }

    const summary = results.reduce(
      (acc, item) => {
        acc.recordsRead += item.recordsRead;
        acc.recordsWritten += item.recordsWritten;
        acc.errors += item.errors;
        return acc;
      },
      { recordsRead: 0, recordsWritten: 0, errors: 0 }
    );

    return {
      recordsRead: summary.recordsRead,
      recordsWritten: summary.recordsWritten,
      errors: summary.errors,
      logs: {
        providers: results,
        runId
      }
    };
  }

  private teamRatingSeed(name: string, country: string, isHome: boolean) {
    const token = `${name}:${country}`.toLowerCase();
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) % 100000;
    }
    const base = 1450 + (hash % 220);
    return base;
  }

  private dedupeRiskFlags(
    flags: Array<{
      code: string;
      severity: string;
      message: string;
    }>
  ) {
    const seen = new Set<string>();
    const unique: Array<{
      code: string;
      severity: string;
      message: string;
    }> = [];

    for (const flag of flags) {
      const signature = `${flag.code}|${flag.severity}|${flag.message}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      unique.push(flag);
    }
    return unique;
  }

  private toPercent(value: number) {
    return Math.round(value * 100);
  }

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private normalizeOutcome(probabilities: { home: number; draw: number; away: number }) {
    const safe = {
      home: this.clamp(Number.isFinite(probabilities.home) ? probabilities.home : 0, 0, 1),
      draw: this.clamp(Number.isFinite(probabilities.draw) ? probabilities.draw : 0, 0, 1),
      away: this.clamp(Number.isFinite(probabilities.away) ? probabilities.away : 0, 0, 1)
    };
    const sum = safe.home + safe.draw + safe.away || 1;
    return {
      home: Number((safe.home / sum).toFixed(4)),
      draw: Number((safe.draw / sum).toFixed(4)),
      away: Number((safe.away / sum).toFixed(4))
    };
  }

  private rebalanceOutcomeProbabilities(
    probabilities: { home: number; draw: number; away: number },
    homeElo: number,
    awayElo: number,
    expectedHomeGoals: number,
    expectedAwayGoals: number
  ) {
    let outcome = this.normalizeOutcome(probabilities);
    const eloGap = homeElo - awayElo;
    const lambdaGap = expectedHomeGoals - expectedAwayGoals;
    const currentEdge = outcome.home - outcome.away;
    const expectedEdge = this.clamp(eloGap / 480 + lambdaGap * 0.22, -0.24, 0.24);

    // If venue bias inflates the home edge beyond what Elo/lambda justify, shift some mass to away.
    const edgeDrift = currentEdge - expectedEdge;
    if (Math.abs(edgeDrift) > 0.02) {
      const correction = this.clamp(edgeDrift * 0.42, -0.09, 0.09);
      outcome = this.normalizeOutcome({
        home: outcome.home - correction,
        draw: outcome.draw,
        away: outcome.away + correction
      });
    }

    // In balanced games, increase draw mass slightly to avoid forced home/away winners.
    const neutrality = this.clamp(
      1 - Math.min(1, Math.abs(eloGap) / 140) - Math.min(1, Math.abs(lambdaGap) / 0.9),
      0,
      1
    );
    if (neutrality > 0) {
      const drawBoost = this.clamp(0.06 * neutrality, 0, 0.045);
      outcome = this.normalizeOutcome({
        home: outcome.home - drawBoost * 0.5,
        draw: outcome.draw + drawBoost,
        away: outcome.away - drawBoost * 0.5
      });
    }

    return outcome;
  }

  private contextNumber(context: Record<string, unknown> | null, key: string, fallback: number | null = null) {
    if (!context) {
      return fallback;
    }
    const value = context[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    return fallback;
  }

  private isAdvancedModel(model: { modelName: string; version: string } | null) {
    if (!model) {
      return false;
    }
    return (
      (model.modelName === "elo_poisson_dc" && model.version.startsWith("v2")) ||
      (model.modelName === "elo_poisson" && model.version.toLowerCase().includes("dc_v2"))
    );
  }

  private async buildTeamEloBackfillMap(teamIds: string[], before: Date) {
    if (teamIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.prisma.match.findMany({
      where: {
        matchDateTimeUTC: { lte: before },
        OR: [
          { homeTeamId: { in: teamIds }, homeElo: { not: null } },
          { awayTeamId: { in: teamIds }, awayElo: { not: null } }
        ]
      },
      select: {
        matchDateTimeUTC: true,
        homeTeamId: true,
        awayTeamId: true,
        homeElo: true,
        awayElo: true
      },
      orderBy: { matchDateTimeUTC: "desc" },
      take: 50000
    });

    const map = new Map<string, number>();
    for (const row of rows) {
      if (row.homeElo !== null && !map.has(row.homeTeamId)) {
        map.set(row.homeTeamId, Number(row.homeElo));
      }
      if (row.awayElo !== null && !map.has(row.awayTeamId)) {
        map.set(row.awayTeamId, Number(row.awayElo));
      }
      if (map.size >= teamIds.length) {
        break;
      }
    }

    return map;
  }

  private async buildTeamStandingEloMap(teamIds: string[]) {
    if (teamIds.length === 0) {
      return new Map<string, number>();
    }

    const rows = await this.prisma.standing.findMany({
      where: {
        teamId: { in: teamIds },
        played: { gt: 3 }
      },
      select: {
        teamId: true,
        played: true,
        points: true,
        rank: true,
        updatedAt: true
      },
      orderBy: { updatedAt: "desc" },
      take: 20000
    });

    const map = new Map<string, number>();
    for (const row of rows) {
      if (map.has(row.teamId)) {
        continue;
      }

      const ppg = row.played > 0 ? row.points / row.played : 1.2;
      const ppgBoost = (ppg - 1.35) * 260;
      const rankBoost =
        typeof row.rank === "number" && Number.isFinite(row.rank)
          ? Math.max(-65, Math.min(65, (12 - row.rank) * 4))
          : 0;

      const derived = 1500 + ppgBoost + rankBoost;
      const bounded = Math.max(1320, Math.min(1680, derived));
      map.set(row.teamId, Number(bounded.toFixed(2)));
    }

    return map;
  }

  private async generatePredictions(runId: string): Promise<SyncSummary> {
    const now = new Date();
    const riskTuningSettings = await this.loadPredictionRiskTuningSettings();
    const fromDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const toDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const activeModel =
      (await this.prisma.modelVersion.findFirst({
        where: { active: true },
        orderBy: { createdAt: "desc" }
      })) ??
      (await this.prisma.modelVersion.findFirst({
        orderBy: { createdAt: "desc" }
      }));

    const upcomingCandidates = await this.prisma.match.findMany({
      where: {
        status: { in: [MatchStatus.scheduled, MatchStatus.live] },
        matchDateTimeUTC: { lte: toDate }
      },
      include: {
        league: true,
        homeTeam: true,
        awayTeam: true
      },
      orderBy: { matchDateTimeUTC: "asc" },
      take: 1500
    });

    const recentFinishedCandidates = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.finished,
        matchDateTimeUTC: { gte: fromDate, lte: now }
      },
      include: {
        league: true,
        homeTeam: true,
        awayTeam: true
      },
      orderBy: { matchDateTimeUTC: "desc" },
      take: 600
    });

    const backfillPredictionFilters: Prisma.MatchWhereInput[] = activeModel?.id
      ? [{ prediction: null }, { prediction: { is: { modelVersionId: { not: activeModel.id } } } }]
      : [{ prediction: null }];

    const backfillCandidates = await this.prisma.match.findMany({
      where: {
        OR: backfillPredictionFilters,
        status: MatchStatus.finished,
        matchDateTimeUTC: { lte: now }
      },
      include: {
        league: true,
        homeTeam: true,
        awayTeam: true
      },
      orderBy: { matchDateTimeUTC: "desc" },
      take: 1000
    });

    const candidateMap = new Map<string, (typeof upcomingCandidates)[number]>();
    const pushCandidate = (candidate: (typeof upcomingCandidates)[number]) => {
      if (!candidateMap.has(candidate.id)) {
        candidateMap.set(candidate.id, candidate);
      }
    };

    for (const match of upcomingCandidates) {
      pushCandidate(match);
    }
    for (const match of recentFinishedCandidates) {
      pushCandidate(match);
    }
    for (const match of backfillCandidates) {
      pushCandidate(match);
    }

    const candidates = Array.from(candidateMap.values());
    const teamIds = Array.from(
      new Set(
        candidates.flatMap((candidate) => [candidate.homeTeamId, candidate.awayTeamId])
      )
    );
    const eloBackfillByTeamId = await this.buildTeamEloBackfillMap(teamIds, now);
    const standingEloByTeamId = await this.buildTeamStandingEloMap(teamIds);

    const contextFeatureSet = await this.prisma.featureSet.findUnique({
      where: {
        name_version: {
          name: "context_enrichment",
          version: "v1"
        }
      }
    });

    const contextSnapshots =
      contextFeatureSet && candidates.length > 0
        ? await this.prisma.matchFeatureSnapshot.findMany({
            where: {
              featureSetId: contextFeatureSet.id,
              matchId: { in: candidates.map((item) => item.id) }
            }
          })
        : [];

    const contextByMatchId = new Map<string, Record<string, unknown>>();
    for (const snapshot of contextSnapshots) {
      if (snapshot.features && typeof snapshot.features === "object" && !Array.isArray(snapshot.features)) {
        contextByMatchId.set(snapshot.matchId, snapshot.features as Record<string, unknown>);
      }
    }

    let written = 0;
    let errors = 0;

    for (const match of candidates) {
      try {
        let context = contextByMatchId.get(match.id) ?? null;
        const shouldEnrichContext =
          match.status === MatchStatus.scheduled ||
          match.status === MatchStatus.live ||
          match.matchDateTimeUTC.getTime() >= now.getTime() - 3 * 24 * 60 * 60 * 1000;
        const contextExpectedHome =
          context && typeof context.expectedHomeGoalsBase === "number" ? Number(context.expectedHomeGoalsBase) : null;
        const contextExpectedAway =
          context && typeof context.expectedAwayGoalsBase === "number" ? Number(context.expectedAwayGoalsBase) : null;
        const hasContextLambdas =
          context &&
          typeof context.adjustedLambdaHome === "number" &&
          typeof context.adjustedLambdaAway === "number";
        const contextLooksLegacyDefault =
          contextExpectedHome !== null &&
          contextExpectedAway !== null &&
          Math.abs(contextExpectedHome - 1.25) < 0.0001 &&
          Math.abs(contextExpectedAway - 1.05) < 0.0001;
        const homeHistoricalElo = match.homeElo === null ? eloBackfillByTeamId.get(match.homeTeamId) ?? null : null;
        const awayHistoricalElo = match.awayElo === null ? eloBackfillByTeamId.get(match.awayTeamId) ?? null : null;
        const homeStandingElo = match.homeElo === null ? standingEloByTeamId.get(match.homeTeamId) ?? null : null;
        const awayStandingElo = match.awayElo === null ? standingEloByTeamId.get(match.awayTeamId) ?? null : null;
        const missingDirectElo = match.homeElo === null || match.awayElo === null;
        const shouldRefreshContext = shouldEnrichContext && (!hasContextLambdas || (missingDirectElo && contextLooksLegacyDefault));

        if (shouldRefreshContext) {
          const enriched = await this.matchContextEnrichment.upsertContext({
            matchId: match.id,
            kickoffAt: match.matchDateTimeUTC,
            sportCode: "football",
            leagueName: match.league.name,
            homeTeamName: match.homeTeam.name,
            awayTeamName: match.awayTeam.name,
            homeTeamCountry: match.homeTeam.country ?? "INT",
            awayTeamCountry: match.awayTeam.country ?? "INT",
            status: match.status,
            homeScore: match.homeScore,
            awayScore: match.awayScore,
            homeElo: match.homeElo ?? homeHistoricalElo ?? homeStandingElo,
            awayElo: match.awayElo ?? awayHistoricalElo ?? awayStandingElo,
            form5Home: match.form5Home,
            form5Away: match.form5Away,
            source: "internal_prediction_engine"
          });
          if (enriched && typeof enriched === "object" && !Array.isArray(enriched)) {
            context = enriched as Record<string, unknown>;
            contextByMatchId.set(match.id, context);
          }
        }

        let homeEloSource: "direct" | "historical" | "standing" | "seed" = "seed";
        let awayEloSource: "direct" | "historical" | "standing" | "seed" = "seed";

        let homeElo = match.homeElo;
        if (homeElo !== null) {
          homeEloSource = "direct";
        } else if (homeHistoricalElo !== null) {
          homeElo = homeHistoricalElo;
          homeEloSource = "historical";
        } else if (homeStandingElo !== null) {
          homeElo = homeStandingElo;
          homeEloSource = "standing";
        } else {
          homeElo = this.teamRatingSeed(match.homeTeam.name, match.homeTeam.country ?? "INT", true);
        }

        let awayElo = match.awayElo;
        if (awayElo !== null) {
          awayEloSource = "direct";
        } else if (awayHistoricalElo !== null) {
          awayElo = awayHistoricalElo;
          awayEloSource = "historical";
        } else if (awayStandingElo !== null) {
          awayElo = awayStandingElo;
          awayEloSource = "standing";
        } else {
          awayElo = this.teamRatingSeed(match.awayTeam.name, match.awayTeam.country ?? "INT", false);
        }

        if (
          (homeEloSource === "historical" ||
            awayEloSource === "historical" ||
            homeEloSource === "standing" ||
            awayEloSource === "standing") &&
          (match.homeElo === null || match.awayElo === null)
        ) {
          const patch: Prisma.MatchUpdateInput = {};
          if (match.homeElo === null && (homeEloSource === "historical" || homeEloSource === "standing")) {
            patch.homeElo = homeElo;
          }
          if (match.awayElo === null && (awayEloSource === "historical" || awayEloSource === "standing")) {
            patch.awayElo = awayElo;
          }
          if (Object.keys(patch).length > 0) {
            patch.updatedByProcess = "prediction_elo_backfill";
            await this.prisma.match.update({
              where: { id: match.id },
              data: patch
            });
          }
        }
        const homeAttack = Math.max(0.78, Math.min(1.45, homeElo / 1680));
        const awayAttack = Math.max(0.78, Math.min(1.45, awayElo / 1680));
        const homeDefense = Math.max(0.72, Math.min(1.35, 2 - homeElo / 1800));
        const awayDefense = Math.max(0.72, Math.min(1.35, 2 - awayElo / 1800));

        let rawProbabilities = this.predictionEngine.computeEloProbabilities({ homeElo, awayElo });
        let calibratedProbabilities = this.predictionEngine.calibrate(rawProbabilities, 0.97);
        let rawConfidenceScore = this.predictionEngine.confidence(rawProbabilities);
        let calibratedConfidenceScore = this.predictionEngine.confidence(calibratedProbabilities);

        const defaultExpectedScore = this.predictionEngine.poissonExpectedScore(homeAttack, awayAttack, homeDefense, awayDefense);
        let expectedScore: Record<string, unknown> =
          context &&
          typeof context.adjustedLambdaHome === "number" &&
          typeof context.adjustedLambdaAway === "number"
            ? {
                home: Number(context.adjustedLambdaHome),
                away: Number(context.adjustedLambdaAway)
              }
            : { ...defaultExpectedScore };
        let riskFlags: Array<{ code: string; severity: string; message: string }> = [];

        if (this.isAdvancedModel(activeModel ? { modelName: activeModel.modelName, version: activeModel.version } : null)) {
          try {
            const advanced = this.advancedPredictionEngine.compute({
              homeElo,
              awayElo,
              homeAttack,
              awayAttack,
              homeDefense,
              awayDefense,
              form5Home: match.form5Home,
              form5Away: match.form5Away,
              scheduleFatigueScore: this.contextNumber(context, "scheduleFatigueScore"),
              lineupCertaintyScore: this.contextNumber(context, "lineupCertaintyScore"),
              contextPressureScore: this.contextNumber(context, "contextPressureScore"),
              leagueGoalEnvironment: this.contextNumber(context, "leagueGoalEnvironment", 1),
              homeAwaySplitStrength: this.contextNumber(context, "homeAwaySplitStrength", 0.5),
              opponentAdjustedStrength: this.contextNumber(context, "opponentAdjustedStrength", 0.5),
              baselineAdjustedLambdaHome: this.contextNumber(context, "adjustedLambdaHome"),
              baselineAdjustedLambdaAway: this.contextNumber(context, "adjustedLambdaAway"),
              lowScoreBias: this.contextNumber(context, "lowScoreBias"),
              riskTuning: {
                lowScoreBiasThreshold: riskTuningSettings.lowScoreBiasThreshold,
                lowScoreTotalGoalsThreshold: riskTuningSettings.lowScoreTotalGoalsThreshold,
                conflictBaseEloGap: riskTuningSettings.conflictBaseEloGap,
                conflictLeagueGoalEnvMultiplier: riskTuningSettings.conflictLeagueGoalEnvMultiplier,
                conflictVolatilityMultiplier: riskTuningSettings.conflictVolatilityMultiplier,
                conflictOutcomeEdgeBase: riskTuningSettings.conflictOutcomeEdgeBase,
                conflictOutcomeEdgeVolatilityMultiplier: riskTuningSettings.conflictOutcomeEdgeVolatilityMultiplier,
                conflictMinCalibratedConfidence: riskTuningSettings.conflictMinCalibratedConfidence
              },
              kickoffAt: match.matchDateTimeUTC,
              now
            });

            rawProbabilities = advanced.rawProbabilities;
            calibratedProbabilities = advanced.calibratedProbabilities;
            rawConfidenceScore = advanced.rawConfidenceScore;
            calibratedConfidenceScore = advanced.calibratedConfidenceScore;
            riskFlags = [...riskFlags, ...advanced.advancedRiskFlags];
            expectedScore = {
              home: advanced.adjustedLambdaHome,
              away: advanced.adjustedLambdaAway,
              lambdaHome: advanced.lambdaHome,
              lambdaAway: advanced.lambdaAway,
              adjustedLambdaHome: advanced.adjustedLambdaHome,
              adjustedLambdaAway: advanced.adjustedLambdaAway,
              eloHome: advanced.eloHome,
              eloAway: advanced.eloAway,
              modelVersion: "elo_poisson_dc_v2",
              scoreMatrix: advanced.scoreMatrixTop,
              lowScoreBiasApplied: advanced.lowScoreBiasApplied,
              instabilityScore: advanced.instabilityScore
            };
          } catch (error) {
            this.logger.warn(
              `Advanced prediction engine fallback for match ${match.id}: ${
                error instanceof Error ? error.message : "unknown error"
              }`
            );
            riskFlags.push({
              code: "ADVANCED_ENGINE_FALLBACK",
              severity: "low",
              message: "Gelistirilmis model gecici olarak kullanilamadi, klasik motor devrede."
            });
          }
        }

        const expectedHomeGoals =
          typeof expectedScore.home === "number" && Number.isFinite(expectedScore.home)
            ? expectedScore.home
            : defaultExpectedScore.home;
        const expectedAwayGoals =
          typeof expectedScore.away === "number" && Number.isFinite(expectedScore.away)
            ? expectedScore.away
            : defaultExpectedScore.away;
        rawProbabilities = this.rebalanceOutcomeProbabilities(
          rawProbabilities,
          homeElo,
          awayElo,
          expectedHomeGoals,
          expectedAwayGoals
        );
        calibratedProbabilities = this.rebalanceOutcomeProbabilities(
          calibratedProbabilities,
          homeElo,
          awayElo,
          expectedHomeGoals,
          expectedAwayGoals
        );
        rawConfidenceScore = this.predictionEngine.confidence(rawProbabilities);
        calibratedConfidenceScore = this.predictionEngine.confidence(calibratedProbabilities);

        const kickoffHoursAway = (match.matchDateTimeUTC.getTime() - now.getTime()) / (60 * 60 * 1000);
        const isUpcomingKickoffWindow = kickoffHoursAway >= 0 && kickoffHoursAway <= 72;
        const isImmediateKickoffWindow = kickoffHoursAway >= 0 && kickoffHoursAway <= 8;
        if (homeEloSource === "seed" || awayEloSource === "seed") {
          if (isUpcomingKickoffWindow) {
            calibratedConfidenceScore = Number(Math.max(0.34, calibratedConfidenceScore - 0.012).toFixed(4));
          }
          if (homeEloSource === "seed" && awayEloSource === "seed" && isImmediateKickoffWindow) {
            riskFlags.push({
              code: "LOW_ELO_COVERAGE",
              severity: "medium",
              message: "Elo verisi eksik, model seed degeri kullandi."
            });
          }
        } else if (homeEloSource === "historical" || awayEloSource === "historical") {
          riskFlags.push({
            code: "ELO_BACKFILLED",
            severity: "low",
            message: "Elo degerleri son resmi maclardan tamamlandi."
          });
        }

        const weatherImpactScore =
          context && typeof context.weatherImpactScore === "number" ? Number(context.weatherImpactScore) : null;
        const lineupCertaintyScore =
          context && typeof context.lineupCertaintyScore === "number" ? Number(context.lineupCertaintyScore) : null;
        const refereeStrictnessScore =
          context && typeof context.refereeStrictnessScore === "number" ? Number(context.refereeStrictnessScore) : null;
        const refereeSource =
          context && typeof context.refereeSource === "string" ? String(context.refereeSource) : "provider_official";
        const lineupCoverage =
          context && typeof context.thesportsdbLineupCoverage === "number"
            ? Number(context.thesportsdbLineupCoverage)
            : null;
        const eventStatsCoverage =
          context && typeof context.thesportsdbEventStatsCoverage === "number"
            ? Number(context.thesportsdbEventStatsCoverage)
            : null;
        const aliasConfidence =
          context && typeof context.thesportsdbAliasConfidence === "number" ? Number(context.thesportsdbAliasConfidence) : null;

        if (weatherImpactScore !== null && weatherImpactScore > 0.28) {
          calibratedConfidenceScore = Number(Math.max(0.3, calibratedConfidenceScore - 0.03).toFixed(4));
          riskFlags.push({
            code: "WEATHER_VARIANCE",
            severity: "medium",
            message: "Weather conditions can increase match variance."
          });
        }
        if (lineupCertaintyScore !== null && lineupCertaintyScore < 0.58) {
          calibratedConfidenceScore = Number(Math.max(0.28, calibratedConfidenceScore - 0.05).toFixed(4));
          riskFlags.push({
            code: "LOW_LINEUP_CERTAINTY",
            severity: "high",
            message: "Lineup certainty is low close to kickoff."
          });
        }
        if (refereeStrictnessScore !== null && refereeStrictnessScore > 0.82) {
          riskFlags.push({
            code: "REFEREE_STRICTNESS",
            severity: "low",
            message: "Strict referee profile may alter card/foul flow."
          });
        }
        if (refereeSource === "heuristic_fallback") {
          const hasSeedElo = homeEloSource === "seed" || awayEloSource === "seed";
          if (isUpcomingKickoffWindow) {
            calibratedConfidenceScore = Number(
              Math.max(0.33, calibratedConfidenceScore - (hasSeedElo ? 0.012 : 0.006)).toFixed(4)
            );
          }
          if (hasSeedElo && kickoffHoursAway >= 0 && kickoffHoursAway <= 4) {
            riskFlags.push({
              code: "REFEREE_DATA_ESTIMATED",
              severity: "low",
              message: "Hakem bilgisi resmi kaynaktan alinamadigi icin tahmin oynakligi artabilir."
            });
          }
        }
        if (lineupCoverage !== null && lineupCoverage < 0.45) {
          calibratedConfidenceScore = Number(Math.max(0.3, calibratedConfidenceScore - 0.03).toFixed(4));
          riskFlags.push({
            code: "LOW_LINEUP_COVERAGE",
            severity: "medium",
            message: "TheSportsDB lineup coverage is low for this match."
          });
        }
        if (eventStatsCoverage !== null && eventStatsCoverage < 0.45) {
          calibratedConfidenceScore = Number(Math.max(0.3, calibratedConfidenceScore - 0.025).toFixed(4));
          riskFlags.push({
            code: "MISSING_EVENT_STATS",
            severity: "medium",
            message: "Event stats/timeline coverage is limited for this fixture."
          });
        }
        if (aliasConfidence !== null && aliasConfidence < 0.62) {
          calibratedConfidenceScore = Number(Math.max(0.3, calibratedConfidenceScore - 0.02).toFixed(4));
          riskFlags.push({
            code: "ALIAS_CONFIDENCE_LOW",
            severity: "low",
            message: "Provider team alias mapping confidence is low."
          });
        }

        let confidenceScore = Number((0.62 + calibratedConfidenceScore * 0.32).toFixed(4));
        if (isUpcomingKickoffWindow && (homeEloSource === "seed" || awayEloSource === "seed")) {
          confidenceScore -= 0.01;
        }
        if (isUpcomingKickoffWindow && refereeSource === "heuristic_fallback") {
          confidenceScore -= 0.006;
        }
        if (riskFlags.some((flag) => flag.code === "HIGH_VARIANCE_MATCH")) {
          confidenceScore -= 0.02;
        }
        if (riskFlags.some((flag) => flag.code === "LOW_SCORE_BIAS")) {
          confidenceScore -= 0.01;
        }
        confidenceScore = Number(Math.max(0.3, Math.min(0.92, confidenceScore)).toFixed(4));
        riskFlags = [...riskFlags, ...this.predictionEngine.riskFlags(confidenceScore)];
        const informationalRiskCodes = new Set(["LOW_ELO_COVERAGE", "REFEREE_DATA_ESTIMATED", "LOW_SCORE_BIAS"]);
        const uniqueRiskFlags = this.dedupeRiskFlags(riskFlags).filter(
          (flag) => !(confidenceScore >= riskTuningSettings.infoFlagSuppressionThreshold && informationalRiskCodes.has(flag.code))
        );

        const summary = `${match.homeTeam.name} - ${match.awayTeam.name}: Ev ${this.toPercent(
          calibratedProbabilities.home
        )}%, Beraberlik ${this.toPercent(calibratedProbabilities.draw)}%, Deplasman ${this.toPercent(
          calibratedProbabilities.away
        )}%.${weatherImpactScore && weatherImpactScore > 0.28 ? " Hava kosullari oynakligi artirabilir." : ""}`;

        const isLowConfidence = confidenceScore < riskTuningSettings.lowConfidenceThreshold;
        const avoidReasonLowConfidenceThreshold = Math.max(0.35, riskTuningSettings.lowConfidenceThreshold - 0.04);
        const avoidReason =
          lineupCertaintyScore !== null && lineupCertaintyScore < 0.55
            ? "Kadro belirsizligi yuksek, tahmin temkinli degerlendirilmeli."
            : confidenceScore < avoidReasonLowConfidenceThreshold
            ? "Guven skoru dusuk oldugu icin temkinli yorumlanmali."
            : uniqueRiskFlags.length > 0
              ? "Degiskenlik yuksek, kesin sonuc beklentisi onerilmez."
              : null;

        await this.prisma.prediction.upsert({
          where: { matchId: match.id },
          update: {
            modelVersionId: activeModel?.id ?? null,
            probabilities: calibratedProbabilities as Prisma.InputJsonValue,
            expectedScore: expectedScore as Prisma.InputJsonValue,
            rawProbabilities: rawProbabilities as Prisma.InputJsonValue,
            calibratedProbabilities: calibratedProbabilities as Prisma.InputJsonValue,
            rawConfidenceScore,
            calibratedConfidenceScore,
            confidenceScore,
            summary,
            riskFlags: uniqueRiskFlags as Prisma.InputJsonValue,
            isRecommended: confidenceScore >= 0.6 && !isLowConfidence,
            isLowConfidence,
            avoidReason,
            updatedByProcess: "generate_predictions_job",
            importedAt: new Date(),
            dataSource: "generated"
          },
          create: {
            matchId: match.id,
            modelVersionId: activeModel?.id ?? null,
            probabilities: calibratedProbabilities as Prisma.InputJsonValue,
            expectedScore: expectedScore as Prisma.InputJsonValue,
            rawProbabilities: rawProbabilities as Prisma.InputJsonValue,
            calibratedProbabilities: calibratedProbabilities as Prisma.InputJsonValue,
            rawConfidenceScore,
            calibratedConfidenceScore,
            confidenceScore,
            summary,
            riskFlags: uniqueRiskFlags as Prisma.InputJsonValue,
            isRecommended: confidenceScore >= 0.6 && !isLowConfidence,
            isLowConfidence,
            avoidReason,
            updatedByProcess: "generate_predictions_job",
            importedAt: new Date(),
            dataSource: "generated"
          }
        });
        written += 1;
      } catch (error) {
        errors += 1;
        this.logger.error(
          `Prediction generation failed for match ${match.id}: ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
      }
    }

    await this.createExternalPayload("internal_prediction_engine", runId, "generated_predictions", {
      recordsRead: candidates.length,
      recordsWritten: written,
      errors
    });

    await this.logApiCall("provider/internal_prediction_engine/generatePredictions", 200, 0, runId);

    return {
      recordsRead: candidates.length,
      recordsWritten: written,
      errors,
      logs: {
        mode: "generatePredictions",
        modelVersionId: activeModel?.id ?? null,
        modelName: activeModel?.modelName ?? null,
        modelVersion: activeModel?.version ?? null
      }
    };
  }

  private todayDateString(offsetDays = 0) {
    const now = new Date();
    now.setUTCDate(now.getUTCDate() + offsetDays);
    return now.toISOString().slice(0, 10);
  }

  private parseIsoDateOnly(raw: string | undefined) {
    if (!raw || raw.trim().length === 0) {
      return null;
    }
    const value = raw.trim();
    const parsed = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  private toSafeRoundMax(raw: number | undefined, fallback = 60) {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return fallback;
    }
    return Math.min(120, Math.max(1, Math.floor(raw)));
  }

  private async sleep(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async normalizeStaleMatchStatuses(runId: string) {
    const staleBefore = new Date(Date.now() - 6 * 60 * 60 * 1000);

    const [scheduledNormalized, finishedWithoutScoreNormalized] = await Promise.all([
      this.prisma.match.updateMany({
        where: {
          status: MatchStatus.scheduled,
          matchDateTimeUTC: { lt: staleBefore },
          homeScore: null,
          awayScore: null
        },
        data: {
          status: MatchStatus.postponed,
          updatedByProcess: "status_normalizer"
        }
      }),
      this.prisma.match.updateMany({
        where: {
          status: MatchStatus.finished,
          matchDateTimeUTC: { lt: staleBefore },
          OR: [{ homeScore: null }, { awayScore: null }]
        },
        data: {
          status: MatchStatus.postponed,
          updatedByProcess: "status_normalizer"
        }
      })
    ]);

    const totalNormalized = scheduledNormalized.count + finishedWithoutScoreNormalized.count;
    if (totalNormalized <= 0) {
      return;
    }

    await this.createExternalPayload("internal", runId, "match_status_normalization", {
      staleBefore: staleBefore.toISOString(),
      scheduledToPostponed: scheduledNormalized.count,
      finishedWithoutScoreToPostponed: finishedWithoutScoreNormalized.count,
      totalNormalized
    });
  }

  private async getCheckpoint(providerKey: string, entityType: string) {
    const checkpoint = await this.prisma.ingestionCheckpoint.findUnique({
      where: {
        providerKey_entityType: {
          providerKey,
          entityType
        }
      }
    });

    return checkpoint?.cursor;
  }

  private async setCheckpoint(providerKey: string, entityType: string, cursor: string) {
    await this.prisma.ingestionCheckpoint.upsert({
      where: {
        providerKey_entityType: {
          providerKey,
          entityType
        }
      },
      update: {
        cursor,
        lastSyncedAt: new Date()
      },
      create: {
        providerKey,
        entityType,
        cursor,
        lastSyncedAt: new Date()
      }
    });
  }

  private footballSeasonLabel(date: Date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    return month >= 7 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  }

  private basketballSeasonLabel(date: Date) {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    return month >= 9 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
  }

  private normalizeKey(value: string) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  private normalizeAlias(value: string) {
    return value
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\b(fc|cf|sc|afc|ac|fk|bk|club|football|deportivo|athletic|atletico)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private parseTheSportsDbTeamCandidate(raw: Record<string, unknown>): TheSportsDbTeamCandidate | null {
    const idTeam = String(raw.idTeam ?? "").trim();
    const strTeam = String(raw.strTeam ?? "").trim();
    if (idTeam.length === 0 || strTeam.length === 0) {
      return null;
    }

    const formedYearRaw = Number(raw.intFormedYear);
    return {
      idTeam,
      strTeam,
      strCountry: String(raw.strCountry ?? "INT").trim() || "INT",
      strTeamShort: typeof raw.strTeamShort === "string" && raw.strTeamShort.trim().length > 0 ? raw.strTeamShort.trim() : null,
      intFormedYear: Number.isFinite(formedYearRaw) ? Math.floor(formedYearRaw) : null,
      strAlternate: typeof raw.strAlternate === "string" && raw.strAlternate.trim().length > 0 ? raw.strAlternate.trim() : null
    };
  }

  private splitAlternates(value: string | null) {
    if (!value) {
      return [];
    }
    return value
      .split(/[;,|]/g)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  private toStringListUnique(values: Array<string | null | undefined>) {
    const seen = new Set<string>();
    for (const value of values) {
      if (!value) {
        continue;
      }
      const normalized = value.trim();
      if (normalized.length > 0) {
        seen.add(normalized);
      }
    }
    return Array.from(seen.values());
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private toRecordArray(value: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(value)) {
      return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item));
    }
    const asRecord = this.toRecord(value);
    return asRecord ? [asRecord] : [];
  }

  private parseBooleanConfig(value: unknown, fallback: boolean) {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const token = value.trim().toLowerCase();
      if (token === "true" || token === "1" || token === "yes") {
        return true;
      }
      if (token === "false" || token === "0" || token === "no") {
        return false;
      }
    }
    return fallback;
  }

  private normalizeCountry(value: string | null | undefined) {
    const token = (value ?? "").trim();
    if (token.length === 0) {
      return "INT";
    }
    return token;
  }

  private hasScorePair(homeScore: number | null | undefined, awayScore: number | null | undefined) {
    return homeScore !== null && homeScore !== undefined && awayScore !== null && awayScore !== undefined;
  }

  private providerReliabilityScore(dataSource: string | null | undefined) {
    const key = (dataSource ?? "").trim().toLowerCase();
    if (key === "api_football") {
      return 100;
    }
    if (key === "football_data") {
      return 95;
    }
    if (key === "sportapi_ai") {
      return 85;
    }
    if (key === "the_sports_db") {
      return 70;
    }
    if (key === "historical_csv") {
      return 60;
    }
    if (key === "generated") {
      return 40;
    }
    return 50;
  }

  private mergeMatchState(
    existing: {
      status: MatchStatus;
      homeScore: number | null;
      awayScore: number | null;
      homeElo: number | null;
      awayElo: number | null;
      form5Home: number | null;
      form5Away: number | null;
      dataSource: string | null;
    } | null,
    input: MatchSeedInput,
    normalizedIncomingStatus: MatchStatus
  ) {
    const incomingHasScore = this.hasScorePair(input.homeScore, input.awayScore);
    const existingHasScore = this.hasScorePair(existing?.homeScore, existing?.awayScore);

    let status = normalizedIncomingStatus;
    let homeScore = input.homeScore;
    let awayScore = input.awayScore;
    let statusAdjustedFromFinishedWithoutScore = false;
    let statusAdjustedFromStaleScheduled = false;
    let scoreConflictResolved: null | {
      keptExisting: boolean;
      existingScore: { home: number | null; away: number | null; source: string | null };
      incomingScore: { home: number | null; away: number | null; source: string };
      resolvedScore: { home: number | null; away: number | null; source: string | null };
    } = null;

    if (existingHasScore && incomingHasScore) {
      const scoreDiffers = existing!.homeScore !== input.homeScore || existing!.awayScore !== input.awayScore;
      if (scoreDiffers) {
        const incomingPriority = this.providerReliabilityScore(input.dataSource);
        const existingPriority = this.providerReliabilityScore(existing!.dataSource);
        const keepExisting = existingPriority > incomingPriority;

        if (keepExisting) {
          homeScore = existing!.homeScore;
          awayScore = existing!.awayScore;
          if (existing!.status === MatchStatus.finished) {
            status = MatchStatus.finished;
          }
        } else {
          status = MatchStatus.finished;
        }

        scoreConflictResolved = {
          keptExisting: keepExisting,
          existingScore: {
            home: existing!.homeScore,
            away: existing!.awayScore,
            source: existing!.dataSource
          },
          incomingScore: {
            home: input.homeScore,
            away: input.awayScore,
            source: input.dataSource
          },
          resolvedScore: {
            home: homeScore,
            away: awayScore,
            source: keepExisting ? existing!.dataSource : input.dataSource
          }
        };
      } else {
        status = MatchStatus.finished;
      }
    } else if (existingHasScore && !incomingHasScore) {
      homeScore = existing!.homeScore;
      awayScore = existing!.awayScore;
      if (existing!.status === MatchStatus.finished || status !== MatchStatus.cancelled) {
        status = MatchStatus.finished;
      }
    } else if (incomingHasScore) {
      status = MatchStatus.finished;
    }

    if (existing?.status === MatchStatus.finished && existingHasScore && status !== MatchStatus.finished) {
      status = MatchStatus.finished;
      homeScore = existing.homeScore;
      awayScore = existing.awayScore;
    }

    if (status === MatchStatus.finished && !this.hasScorePair(homeScore, awayScore)) {
      statusAdjustedFromFinishedWithoutScore = true;
      if (existing?.status && existing.status !== MatchStatus.finished) {
        status = existing.status;
      } else if (normalizedIncomingStatus === MatchStatus.live) {
        status = MatchStatus.live;
      } else if (normalizedIncomingStatus === MatchStatus.postponed || normalizedIncomingStatus === MatchStatus.cancelled) {
        status = normalizedIncomingStatus;
      } else {
        status = MatchStatus.scheduled;
      }
    }

    if (status === MatchStatus.scheduled && !this.hasScorePair(homeScore, awayScore)) {
      const kickoffMs = input.kickoffAt.getTime();
      if (kickoffMs < Date.now() - 6 * 60 * 60 * 1000) {
        status = MatchStatus.postponed;
        statusAdjustedFromStaleScheduled = true;
      }
    }

    const homeElo = input.homeElo ?? existing?.homeElo ?? null;
    const awayElo = input.awayElo ?? existing?.awayElo ?? null;
    const form5Home = input.form5Home ?? existing?.form5Home ?? null;
    const form5Away = input.form5Away ?? existing?.form5Away ?? null;

    return {
      status,
      homeScore,
      awayScore,
      homeElo,
      awayElo,
      form5Home,
      form5Away,
      statusAdjustedFromFinishedWithoutScore,
      statusAdjustedFromStaleScheduled,
      scoreConflictResolved
    };
  }

  private async resolveTeamEntity(params: {
    providerId: string;
    teamName: string;
    teamCountry: string;
    dataSource: string;
    now: Date;
  }) {
    const normalizedCountry = this.normalizeCountry(params.teamCountry);
    const providerTeamKey = this.normalizeKey(`${params.teamName}_${normalizedCountry}`);
    const existingProviderMapping =
      providerTeamKey.length > 0
        ? await this.prisma.providerTeamMapping.findUnique({
            where: {
              providerId_providerTeamKey: {
                providerId: params.providerId,
                providerTeamKey
              }
            },
            include: {
              team: true
            }
          })
        : null;

    if (existingProviderMapping?.team) {
      const team = await this.prisma.team.update({
        where: { id: existingProviderMapping.team.id },
        data: {
          dataSource: params.dataSource,
          importedAt: params.now,
          updatedByProcess: "provider_sync"
        }
      });
      await this.upsertEntityAlias("team", team.id, params.teamName, existingProviderMapping.mappingConfidence ?? 0.92);
      return team;
    }

    const normalizedAlias = this.normalizeAlias(params.teamName);
    if (normalizedAlias.length > 0) {
      const alias = await this.prisma.entityAlias.findUnique({
        where: {
          entityType_normalizedAlias: {
            entityType: "team",
            normalizedAlias
          }
        }
      });
      if (alias) {
        const aliasTeam = await this.prisma.team.findUnique({
          where: { id: alias.entityId }
        });
        if (aliasTeam && this.countryMatches(aliasTeam.country, normalizedCountry)) {
          const updatedAliasTeam = await this.prisma.team.update({
            where: { id: aliasTeam.id },
            data: {
              dataSource: params.dataSource,
              importedAt: params.now,
              updatedByProcess: "provider_sync"
            }
          });
          await this.upsertEntityAlias("team", updatedAliasTeam.id, params.teamName, alias.confidence ?? 0.9);
          return updatedAliasTeam;
        }
      }
    }

    const nameCandidates = await this.prisma.team.findMany({
      where: {
        OR: [
          { name: { equals: params.teamName, mode: "insensitive" } },
          { shortName: { equals: params.teamName, mode: "insensitive" } }
        ]
      },
      take: 10
    });
    const countryCandidate = nameCandidates.find((item) => this.countryMatches(item.country, normalizedCountry));
    const selectedCandidate = countryCandidate ?? nameCandidates[0];

    if (selectedCandidate) {
      const updatedTeam = await this.prisma.team.update({
        where: { id: selectedCandidate.id },
        data: {
          dataSource: params.dataSource,
          importedAt: params.now,
          updatedByProcess: "provider_sync"
        }
      });
      await this.upsertEntityAlias("team", updatedTeam.id, params.teamName, 0.9);
      return updatedTeam;
    }

    const createdTeam = await this.prisma.team.upsert({
      where: {
        name_country: {
          name: params.teamName,
          country: normalizedCountry
        }
      },
      update: {
        dataSource: params.dataSource,
        importedAt: params.now,
        updatedByProcess: "provider_sync"
      },
      create: {
        name: params.teamName,
        country: normalizedCountry,
        dataSource: params.dataSource,
        importedAt: params.now,
        updatedByProcess: "provider_sync"
      }
    });

    await this.upsertEntityAlias("team", createdTeam.id, params.teamName, 0.88);
    return createdTeam;
  }

  private async upsertEntityAlias(entityType: string, entityId: string, alias: string, confidence: number) {
    const trimmedAlias = alias.trim();
    if (trimmedAlias.length === 0) {
      return;
    }

    const normalizedAlias = this.normalizeAlias(trimmedAlias);
    if (normalizedAlias.length === 0) {
      return;
    }

    await this.prisma.entityAlias.upsert({
      where: {
        entityType_normalizedAlias: {
          entityType,
          normalizedAlias
        }
      },
      update: {
        entityId,
        alias: trimmedAlias,
        confidence
      },
      create: {
        entityType,
        entityId,
        alias: trimmedAlias,
        normalizedAlias,
        confidence
      }
    });
  }

  private async applyContextPatchToFeatureSnapshot(matchId: string, patch: Record<string, unknown>) {
    const featureSet = await this.prisma.featureSet.findUnique({
      where: {
        name_version: {
          name: "context_enrichment",
          version: "v1"
        }
      }
    });
    if (!featureSet) {
      return;
    }

    const existing = await this.prisma.matchFeatureSnapshot.findUnique({
      where: {
        matchId_featureSetId: {
          matchId,
          featureSetId: featureSet.id
        }
      }
    });

    if (!existing) {
      await this.prisma.matchFeatureSnapshot.create({
        data: {
          matchId,
          featureSetId: featureSet.id,
          features: patch as Prisma.InputJsonValue
        }
      });
      return;
    }

    const current = this.toRecord(existing.features) ?? {};
    await this.prisma.matchFeatureSnapshot.update({
      where: { id: existing.id },
      data: {
        features: {
          ...current,
          ...patch
        } as Prisma.InputJsonValue,
        generatedAt: new Date()
      }
    });
  }

  private toNullableScore(value: unknown) {
    if (value === null || value === undefined || typeof value === "boolean") {
      return null;
    }

    if (typeof value === "string") {
      const token = value.trim().toLowerCase();
      if (token.length === 0 || token === "null" || token === "undefined" || token === "n/a" || token === "-") {
        return null;
      }
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return null;
    }
    return Math.round(parsed);
  }

  private normalizeMatchStatus(
    incoming: MatchStatus,
    kickoffAt: Date,
    homeScore: number | null,
    awayScore: number | null
  ): MatchStatus {
    const hasScore = homeScore !== null && awayScore !== null;
    if (hasScore && kickoffAt.getTime() <= Date.now() + 2 * 60 * 60 * 1000) {
      return MatchStatus.finished;
    }
    return incoming;
  }

  private footballStatus(status: string): MatchStatus {
    const value = status.toUpperCase();
    if (["FINISHED", "FT", "AET", "PEN"].some((item) => value.includes(item))) {
      return MatchStatus.finished;
    }
    if (["IN_PLAY", "LIVE", "PAUSED"].some((item) => value.includes(item))) {
      return MatchStatus.live;
    }
    if (value.includes("POSTPONED")) {
      return MatchStatus.postponed;
    }
    if (value.includes("CANCELLED")) {
      return MatchStatus.cancelled;
    }
    return MatchStatus.scheduled;
  }

  private basketballStatus(status: string): MatchStatus {
    const value = status.toLowerCase();
    if (value.includes("final") || value.includes("finished") || value === "ft") {
      return MatchStatus.finished;
    }
    if (value.includes("q") || value.includes("live")) {
      return MatchStatus.live;
    }
    if (value.includes("postponed")) {
      return MatchStatus.postponed;
    }
    if (value.includes("cancel")) {
      return MatchStatus.cancelled;
    }
    return MatchStatus.scheduled;
  }

  private parseEventDate(dateRaw: unknown, timeRaw?: unknown) {
    const datePart = typeof dateRaw === "string" ? dateRaw.trim() : "";
    if (!datePart) {
      return null;
    }

    if (datePart.includes("T")) {
      const direct = new Date(datePart);
      if (!Number.isNaN(direct.getTime())) {
        return direct;
      }
    }

    const timePart = typeof timeRaw === "string" && timeRaw.trim().length > 0 ? timeRaw.trim() : "12:00:00";
    const withSeconds = timePart.length === 5 ? `${timePart}:00` : timePart;

    const parsed = new Date(`${datePart}T${withSeconds}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private pickFootballDataReferee(raw: Record<string, unknown>) {
    const refereesRaw = raw.referees;
    if (!Array.isArray(refereesRaw)) {
      return null;
    }

    const primary =
      refereesRaw.find((item) => {
        if (!item || typeof item !== "object") {
          return false;
        }
        const role = String((item as Record<string, unknown>).type ?? "").toUpperCase();
        return role.includes("REFEREE");
      }) ?? refereesRaw[0];

    if (!primary || typeof primary !== "object") {
      return null;
    }
    const name = String((primary as Record<string, unknown>).name ?? "").trim();
    return name.length > 0 ? name : null;
  }

  private normalizeRefereeName(value: unknown) {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  private pickSportApiReferee(raw: Record<string, unknown>) {
    const directKeys = [
      "referee",
      "referee_name",
      "match_referee",
      "main_official",
      "official",
      "official_name",
      "strReferee",
      "judge"
    ];

    for (const key of directKeys) {
      const directValue = this.normalizeRefereeName(raw[key]);
      if (directValue) {
        return directValue;
      }
    }

    const refereeRecord = this.toRecord(raw.referee);
    if (refereeRecord) {
      const nestedKeys = ["name", "full_name", "display_name", "referee_name"];
      for (const key of nestedKeys) {
        const nestedValue = this.normalizeRefereeName(refereeRecord[key]);
        if (nestedValue) {
          return nestedValue;
        }
      }
    }

    const officials = this.toRecordArray(raw.officials);
    for (const official of officials) {
      const officialName = this.normalizeRefereeName(official.name) ?? this.normalizeRefereeName(official.full_name);
      if (officialName) {
        return officialName;
      }
    }

    return null;
  }

  private async logApiCall(path: string, statusCode: number, durationMs: number, requestId: string) {
    await this.prisma.apiLog.create({
      data: {
        method: "GET",
        path,
        statusCode,
        durationMs,
        requestId
      }
    });
  }

  private async createExternalPayload(providerKey: string, runId: string, entityType: string, payload: Record<string, unknown>) {
    await this.prisma.externalSourcePayload.create({
      data: {
        providerKey,
        entityType,
        entityExternalId: runId,
        payload: payload as Prisma.InputJsonValue
      }
    });
  }

  private async upsertMatchFromExternal(input: MatchSeedInput) {
    const now = new Date();
    const normalizedStatus = this.normalizeMatchStatus(input.status, input.kickoffAt, input.homeScore, input.awayScore);
    const homeCountry = this.normalizeCountry(input.homeTeamCountry);
    const awayCountry = this.normalizeCountry(input.awayTeamCountry);

    const sport = await this.prisma.sport.upsert({
      where: { code: input.sportCode },
      update: { name: input.sportName },
      create: { code: input.sportCode, name: input.sportName }
    });

    const league = await this.prisma.league.upsert({
      where: {
        sportId_name: {
          sportId: sport.id,
          name: input.leagueName
        }
      },
      update: {
        country: input.leagueCountry,
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync"
      },
      create: {
        sportId: sport.id,
        name: input.leagueName,
        country: input.leagueCountry,
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync"
      }
    });

    const seasonLabel = input.sportCode === "football" ? this.footballSeasonLabel(input.kickoffAt) : this.basketballSeasonLabel(input.kickoffAt);
    const [startYearRaw, endYearRaw] = seasonLabel.split("-");
    const startYear = Number(startYearRaw);
    const endYear = Number(endYearRaw);

    const season = await this.prisma.season.upsert({
      where: {
        leagueId_yearLabel: {
          leagueId: league.id,
          yearLabel: seasonLabel
        }
      },
      update: {
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync"
      },
      create: {
        leagueId: league.id,
        yearLabel: seasonLabel,
        startDate: new Date(Date.UTC(startYear, 6, 1, 0, 0, 0)),
        endDate: new Date(Date.UTC(endYear, 5, 30, 23, 59, 59)),
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync"
      }
    });

    const homeTeam = await this.resolveTeamEntity({
      providerId: input.providerId,
      teamName: input.homeTeamName,
      teamCountry: homeCountry,
      dataSource: input.dataSource,
      now
    });
    const awayTeam = await this.resolveTeamEntity({
      providerId: input.providerId,
      teamName: input.awayTeamName,
      teamCountry: awayCountry,
      dataSource: input.dataSource,
      now
    });

    const matchUniqueWhere = {
      sportId_leagueId_seasonId_matchDateTimeUTC_homeTeamId_awayTeamId: {
        sportId: sport.id,
        leagueId: league.id,
        seasonId: season.id,
        matchDateTimeUTC: input.kickoffAt,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id
      }
    } as const;

    const existingMatch = await this.prisma.match.findUnique({
      where: matchUniqueWhere,
      select: {
        id: true,
        status: true,
        homeScore: true,
        awayScore: true,
        homeElo: true,
        awayElo: true,
        form5Home: true,
        form5Away: true,
        dataSource: true
      }
    });

    const merged = this.mergeMatchState(existingMatch, input, normalizedStatus);

    const match = await this.prisma.match.upsert({
      where: {
        sportId_leagueId_seasonId_matchDateTimeUTC_homeTeamId_awayTeamId: {
          sportId: sport.id,
          leagueId: league.id,
          seasonId: season.id,
          matchDateTimeUTC: input.kickoffAt,
          homeTeamId: homeTeam.id,
          awayTeamId: awayTeam.id
        }
      },
      update: {
        status: merged.status,
        homeScore: merged.homeScore,
        awayScore: merged.awayScore,
        homeElo: merged.homeElo,
        awayElo: merged.awayElo,
        form5Home: merged.form5Home,
        form5Away: merged.form5Away,
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync_merge"
      },
      create: {
        sportId: sport.id,
        leagueId: league.id,
        seasonId: season.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        matchDateTimeUTC: input.kickoffAt,
        status: merged.status,
        homeScore: merged.homeScore,
        awayScore: merged.awayScore,
        homeElo: merged.homeElo,
        awayElo: merged.awayElo,
        form5Home: merged.form5Home,
        form5Away: merged.form5Away,
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync",
        mappingConfidence: 0.95,
        dataQualityScore: 0.9
      }
    });

    if (existingMatch?.id && merged.scoreConflictResolved) {
      await this.prisma.auditLog.create({
        data: {
          action: "MATCH_SCORE_CONFLICT_RESOLVED",
          resourceType: "match",
          resourceId: existingMatch.id,
          metadata: {
            providerKey: input.providerKey,
            providerMatchKey: input.providerMatchKey,
            keptExisting: merged.scoreConflictResolved.keptExisting,
            existingScore: merged.scoreConflictResolved.existingScore,
            incomingScore: merged.scoreConflictResolved.incomingScore,
            resolvedScore: merged.scoreConflictResolved.resolvedScore
          } as Prisma.InputJsonValue
        }
      });
    }

    if (merged.statusAdjustedFromFinishedWithoutScore) {
      await this.prisma.auditLog.create({
        data: {
          action: "MATCH_STATUS_NORMALIZED_MISSING_SCORE",
          resourceType: "match",
          resourceId: match.id,
          metadata: {
            providerKey: input.providerKey,
            providerMatchKey: input.providerMatchKey,
            incomingStatus: normalizedStatus,
            normalizedStatus: merged.status,
            incomingScore: {
              home: input.homeScore,
              away: input.awayScore
            }
          } as Prisma.InputJsonValue
        }
      });
    }

    if (merged.statusAdjustedFromStaleScheduled) {
      await this.prisma.auditLog.create({
        data: {
          action: "MATCH_STATUS_NORMALIZED_STALE_SCHEDULED",
          resourceType: "match",
          resourceId: match.id,
          metadata: {
            providerKey: input.providerKey,
            providerMatchKey: input.providerMatchKey,
            incomingStatus: normalizedStatus,
            normalizedStatus: merged.status,
            kickoffAt: input.kickoffAt.toISOString()
          } as Prisma.InputJsonValue
        }
      });
    }

    const kickoffDeltaMs = Math.abs(input.kickoffAt.getTime() - now.getTime());
    const shouldEnrichContext =
      input.sportCode === "football" &&
      (merged.status === MatchStatus.scheduled ||
        merged.status === MatchStatus.live ||
        kickoffDeltaMs <= 3 * 24 * 60 * 60 * 1000 ||
        this.hasScorePair(merged.homeScore, merged.awayScore) ||
        (input.refereeName?.trim().length ?? 0) > 0);

    if (shouldEnrichContext) {
      await this.matchContextEnrichment.upsertContext({
        matchId: match.id,
        kickoffAt: input.kickoffAt,
        sportCode: input.sportCode,
        leagueName: input.leagueName,
        homeTeamName: input.homeTeamName,
        awayTeamName: input.awayTeamName,
        homeTeamCountry: homeCountry,
        awayTeamCountry: awayCountry,
        status: merged.status,
        homeScore: merged.homeScore,
        awayScore: merged.awayScore,
        homeElo: merged.homeElo,
        awayElo: merged.awayElo,
        form5Home: merged.form5Home,
        form5Away: merged.form5Away,
        refereeName: input.refereeName ?? null,
        source: input.dataSource
      });
    }

    await this.prisma.providerMatchMapping.upsert({
      where: {
        providerId_providerMatchKey: {
          providerId: input.providerId,
          providerMatchKey: input.providerMatchKey
        }
      },
      update: {
        matchId: match.id,
        mappingConfidence: 0.98
      },
      create: {
        providerId: input.providerId,
        matchId: match.id,
        providerMatchKey: input.providerMatchKey,
        mappingConfidence: 0.98
      }
    });

    await this.prisma.providerLeagueMapping.upsert({
      where: {
        providerId_providerLeagueKey: {
          providerId: input.providerId,
          providerLeagueKey: this.normalizeKey(input.leagueName)
        }
      },
      update: {
        leagueId: league.id,
        mappingConfidence: 0.95
      },
      create: {
        providerId: input.providerId,
        leagueId: league.id,
        providerLeagueKey: this.normalizeKey(input.leagueName),
        mappingConfidence: 0.95
      }
    });

    await this.prisma.providerTeamMapping.upsert({
      where: {
        providerId_providerTeamKey: {
          providerId: input.providerId,
          providerTeamKey: this.normalizeKey(`${input.homeTeamName}_${homeCountry}`)
        }
      },
      update: {
        teamId: homeTeam.id,
        mappingConfidence: 0.95
      },
      create: {
        providerId: input.providerId,
        teamId: homeTeam.id,
        providerTeamKey: this.normalizeKey(`${input.homeTeamName}_${homeCountry}`),
        mappingConfidence: 0.95
      }
    });

    await this.prisma.providerTeamMapping.upsert({
      where: {
        providerId_providerTeamKey: {
          providerId: input.providerId,
          providerTeamKey: this.normalizeKey(`${input.awayTeamName}_${awayCountry}`)
        }
      },
      update: {
        teamId: awayTeam.id,
        mappingConfidence: 0.95
      },
      create: {
        providerId: input.providerId,
        teamId: awayTeam.id,
        providerTeamKey: this.normalizeKey(`${input.awayTeamName}_${awayCountry}`),
        mappingConfidence: 0.95
      }
    });

    return match.id;
  }

  private extractFootballDataStandingsRows(response: Record<string, unknown>) {
    const standings = this.toRecordArray(response.standings);
    const totalStandings = standings.filter(
      (standing) => String(standing.type ?? "").toUpperCase() === "TOTAL"
    );
    const selectedStandings = totalStandings.length > 0 ? totalStandings : standings;

    const rows: Array<Record<string, unknown>> = [];
    for (const standing of selectedStandings) {
      const stage = String(standing.stage ?? "").trim();
      const type = String(standing.type ?? "").trim();
      const group = String(standing.group ?? "").trim();
      const table = this.toRecordArray(standing.table);
      for (const row of table) {
        rows.push({
          ...row,
          __standingStage: stage,
          __standingType: type,
          __standingGroup: group
        });
      }
    }

    return rows;
  }

  private async upsertFootballDataStanding(input: {
    providerId: string;
    providerKey: string;
    competitionCode: string;
    competitionName: string;
    competitionCountry: string;
    seasonStartDate: string | null;
    seasonEndDate: string | null;
    row: Record<string, unknown>;
    dataSource: string;
  }) {
    const teamObj = this.toRecord(input.row.team);
    const teamName = String(teamObj?.name ?? "").trim();
    if (teamName.length === 0) {
      return false;
    }

    const now = new Date();
    const sport = await this.prisma.sport.upsert({
      where: { code: "football" },
      update: { name: "Football" },
      create: { code: "football", name: "Football" }
    });

    const league = await this.prisma.league.upsert({
      where: {
        sportId_name: {
          sportId: sport.id,
          name: input.competitionName
        }
      },
      update: {
        code: input.competitionCode,
        country: input.competitionCountry,
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync"
      },
      create: {
        sportId: sport.id,
        name: input.competitionName,
        code: input.competitionCode,
        country: input.competitionCountry,
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync"
      }
    });

    await this.prisma.providerLeagueMapping.upsert({
      where: {
        providerId_providerLeagueKey: {
          providerId: input.providerId,
          providerLeagueKey: this.normalizeKey(`competition_${input.competitionCode}`)
        }
      },
      update: {
        leagueId: league.id,
        mappingConfidence: 0.98
      },
      create: {
        providerId: input.providerId,
        leagueId: league.id,
        providerLeagueKey: this.normalizeKey(`competition_${input.competitionCode}`),
        mappingConfidence: 0.98
      }
    });

    const parsedSeasonStart = input.seasonStartDate ? this.parseEventDate(input.seasonStartDate) : null;
    const parsedSeasonEnd = input.seasonEndDate ? this.parseEventDate(input.seasonEndDate) : null;
    const seasonRefDate = parsedSeasonStart ?? parsedSeasonEnd ?? now;
    const seasonLabel = this.footballSeasonLabel(seasonRefDate);
    const [startYearRaw, endYearRaw] = seasonLabel.split("-");
    const startYear = Number(startYearRaw);
    const endYear = Number(endYearRaw);

    const season = await this.prisma.season.upsert({
      where: {
        leagueId_yearLabel: {
          leagueId: league.id,
          yearLabel: seasonLabel
        }
      },
      update: {
        startDate: parsedSeasonStart ?? new Date(Date.UTC(startYear, 6, 1, 0, 0, 0)),
        endDate: parsedSeasonEnd ?? new Date(Date.UTC(endYear, 5, 30, 23, 59, 59)),
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync"
      },
      create: {
        leagueId: league.id,
        yearLabel: seasonLabel,
        startDate: parsedSeasonStart ?? new Date(Date.UTC(startYear, 6, 1, 0, 0, 0)),
        endDate: parsedSeasonEnd ?? new Date(Date.UTC(endYear, 5, 30, 23, 59, 59)),
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync"
      }
    });

    const teamCountry = String(teamObj?.tla ?? input.competitionCountry ?? "INT").trim() || "INT";
    const team = await this.resolveTeamEntity({
      providerId: input.providerId,
      teamName,
      teamCountry,
      dataSource: input.dataSource,
      now
    });

    const providerTeamKey = this.normalizeKey(`${teamName}_${this.normalizeCountry(teamCountry)}`);
    await this.prisma.providerTeamMapping.upsert({
      where: {
        providerId_providerTeamKey: {
          providerId: input.providerId,
          providerTeamKey
        }
      },
      update: {
        teamId: team.id,
        mappingConfidence: 0.95
      },
      create: {
        providerId: input.providerId,
        teamId: team.id,
        providerTeamKey,
        mappingConfidence: 0.95
      }
    });

    const externalTeamId = String(teamObj?.id ?? "").trim();
    if (externalTeamId.length > 0) {
      await this.prisma.providerTeamMapping.upsert({
        where: {
          providerId_providerTeamKey: {
            providerId: input.providerId,
            providerTeamKey: this.normalizeKey(`team_${externalTeamId}`)
          }
        },
        update: {
          teamId: team.id,
          mappingConfidence: 0.98
        },
        create: {
          providerId: input.providerId,
          teamId: team.id,
          providerTeamKey: this.normalizeKey(`team_${externalTeamId}`),
          mappingConfidence: 0.98
        }
      });
    }

    await this.prisma.standing.upsert({
      where: {
        seasonId_teamId: {
          seasonId: season.id,
          teamId: team.id
        }
      },
      update: {
        played: this.toNullableScore(input.row.playedGames) ?? 0,
        won: this.toNullableScore(input.row.won) ?? 0,
        draw: this.toNullableScore(input.row.draw) ?? 0,
        lost: this.toNullableScore(input.row.lost) ?? 0,
        goalsFor: this.toNullableScore(input.row.goalsFor) ?? 0,
        goalsAgainst: this.toNullableScore(input.row.goalsAgainst) ?? 0,
        points: this.toNullableScore(input.row.points) ?? 0,
        rank: this.toNullableScore(input.row.position),
        updatedAt: now
      },
      create: {
        seasonId: season.id,
        teamId: team.id,
        played: this.toNullableScore(input.row.playedGames) ?? 0,
        won: this.toNullableScore(input.row.won) ?? 0,
        draw: this.toNullableScore(input.row.draw) ?? 0,
        lost: this.toNullableScore(input.row.lost) ?? 0,
        goalsFor: this.toNullableScore(input.row.goalsFor) ?? 0,
        goalsAgainst: this.toNullableScore(input.row.goalsAgainst) ?? 0,
        points: this.toNullableScore(input.row.points) ?? 0,
        rank: this.toNullableScore(input.row.position)
      }
    });

    return true;
  }

  private async syncFootballData(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    if (jobType !== "syncFixtures" && jobType !== "syncResults" && jobType !== "syncStandings") {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: `football_data bu iş tipinde kullanılmıyor: ${jobType}`
        }
      };
    }

    const settings = await this.providersService.getProviderRuntimeSettings(provider.key);
    if (!settings.apiKey || settings.apiKey.length === 0) {
      await this.logApiCall(`provider/${provider.key}/competitions/*/matches`, 400, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: { message: "FOOTBALL_DATA_API_KEY veya provider apiKey ayarı eksik. Senkron atlandı." }
      };
    }

    if (jobType === "syncStandings") {
      return this.syncFootballDataStandings(provider, runId, settings);
    }

    const checkpointEntityType = jobType === "syncResults" ? "football_matches_results" : "football_matches_fixtures";
    const checkpoint = await this.getCheckpoint(provider.key, checkpointEntityType);
    const dateTo = this.todayDateString(jobType === "syncResults" ? 1 : 7);
    const defaultDateFrom = this.todayDateString(jobType === "syncResults" ? -30 : -2);
    let dateFrom = defaultDateFrom;
    if (jobType === "syncResults" && checkpoint && checkpoint.length >= 10) {
      const normalized = checkpoint.slice(0, 10);
      if (normalized <= dateTo) {
        dateFrom = normalized;
      }
    }
    const lockKey = `provider-sync:${provider.key}`;
    const lockOwner = `${runId}:${Date.now()}`;
    const lockTtlMs = this.parseEnvInt("FOOTBALL_DATA_PROVIDER_LOCK_TTL_MS", 8 * 60 * 1000);
    const lockAcquired = await this.cache.acquireLock(lockKey, lockOwner, lockTtlMs);
    if (!lockAcquired) {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: "football_data senkronu baska bir worker tarafindan calisiyor. Bu run atlandi.",
          lockKey
        }
      };
    }

    try {
      const minuteRateLimit = this.parseConfigInt(
        settings.minuteRateLimit,
        this.parseEnvInt("FOOTBALL_DATA_RATE_LIMIT_PER_MINUTE", 10)
      );
      const minuteRateBuffer = this.parseConfigInt(
        settings.minuteRateBuffer,
        this.parseEnvInt("FOOTBALL_DATA_RATE_LIMIT_BUFFER", 1)
      );
      const minIntervalMs = this.parseConfigInt(
        settings.minIntervalMs,
        this.parseEnvInt("FOOTBALL_DATA_MIN_INTERVAL_MS", 7000)
      );
      const maxCallsPerRun = this.parseConfigInt(
        settings.maxCallsPerRun,
        this.parseEnvInt("FOOTBALL_DATA_MAX_CALLS_PER_RUN", 6)
      );
      const retryMax = this.parseConfigInt(
        settings.retryMax,
        this.parseEnvInt("FOOTBALL_DATA_RETRY_MAX", 2)
      );

      const rawCodes =
        settings.competitionCodes && settings.competitionCodes.length > 0
          ? settings.competitionCodes
          : [settings.competitionCode || "PL"];
      const competitionCodes = Array.from(
        new Set(
          rawCodes
            .map((code) => code.trim().toUpperCase())
            .filter((code) => code.length > 0)
        )
      );

      if (competitionCodes.length === 0) {
        return {
          providerKey: provider.key,
          recordsRead: 0,
          recordsWritten: 0,
          errors: 0,
          details: {
            message: "football_data competition code listesi bos oldugu icin senkron atlandi."
          }
        };
      }

      const rawPriorityCodes = settings.priorityCompetitionCodes ?? [];
      const priorityCodes = rawPriorityCodes
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code.length > 0 && competitionCodes.includes(code));
      const orderedCompetitionCodes = Array.from(
        new Set([...priorityCodes, ...competitionCodes])
      );

      const cursorRaw = await this.getCheckpoint(provider.key, "football_matches_competition_cursor");
      const parsedCursor = Number(cursorRaw);
      const cursor =
        Number.isFinite(parsedCursor) && parsedCursor >= 0
          ? Math.floor(parsedCursor) % orderedCompetitionCodes.length
          : 0;

      const selectedCount = Math.min(Math.max(1, maxCallsPerRun), orderedCompetitionCodes.length);
      const selectedCompetitionCodes = Array.from(
        { length: selectedCount },
        (_, index) => orderedCompetitionCodes[(cursor + index) % orderedCompetitionCodes.length]
      );
      const selectedSet = new Set(selectedCompetitionCodes);
      const deferredCompetitionCodes = orderedCompetitionCodes.filter((code) => !selectedSet.has(code));
      let nextCursor = (cursor + selectedCount) % orderedCompetitionCodes.length;

    let written = 0;
    let errors = 0;
    let recordsRead = 0;
      let totalWaitMs = 0;
      let totalRetryCount = 0;
      let totalRetryBackoffMs = 0;
      let firstFailedCursorIndex: number | null = null;
    const perCompetition: Array<{
      competitionCode: string;
      recordsRead: number;
      recordsWritten: number;
      errors: number;
      ok: boolean;
        waitMs: number;
        retries: number;
      message?: string;
    }> = [];

      for (const [selectedIndex, competitionCode] of selectedCompetitionCodes.entries()) {
        const absoluteCursorIndex = (cursor + selectedIndex) % orderedCompetitionCodes.length;
        const throttle = await this.footballDataThrottle(
          provider.key,
          minuteRateLimit,
          minuteRateBuffer,
          minIntervalMs
        );
        totalWaitMs += throttle.waitedMs;

      const startedAt = Date.now();
      try {
          const fetched = await this.footballDataFetchMatchesWithRetry(
          settings.apiKey,
          competitionCode,
          dateFrom,
          dateTo,
            settings.baseUrl ?? provider.baseUrl ?? undefined,
            retryMax
          );
          totalRetryCount += fetched.retries;
          totalRetryBackoffMs += fetched.backoffMsTotal;
          const response = fetched.response;
        const durationMs = Date.now() - startedAt;
        await this.logApiCall(`provider/${provider.key}/competitions/${competitionCode}/matches`, 200, durationMs, runId);

        const matches = response.matches ?? [];
        recordsRead += matches.length;
        let competitionWritten = 0;
        let competitionErrors = 0;

        for (const raw of matches) {
          const homeTeamObj = (raw.homeTeam as Record<string, unknown> | undefined) ?? {};
          const awayTeamObj = (raw.awayTeam as Record<string, unknown> | undefined) ?? {};
          const competitionObj = (raw.competition as Record<string, unknown> | undefined) ?? {};
          const scoreObj = (raw.score as Record<string, unknown> | undefined) ?? {};
          const fullTimeObj = (scoreObj.fullTime as Record<string, unknown> | undefined) ?? {};

          const kickoffAt = this.parseEventDate(raw.utcDate);
          const homeTeamName = String(homeTeamObj.name ?? "").trim();
          const awayTeamName = String(awayTeamObj.name ?? "").trim();

          if (!kickoffAt || homeTeamName.length === 0 || awayTeamName.length === 0) {
            errors += 1;
            competitionErrors += 1;
            continue;
          }

          const providerMatchKey = String(raw.id ?? `${competitionCode}-${homeTeamName}-${awayTeamName}-${kickoffAt.toISOString()}`);
          const refereeName = this.pickFootballDataReferee(raw);
          await this.upsertMatchFromExternal({
            providerId: provider.id,
            providerKey: provider.key,
            providerMatchKey,
            sportCode: "football",
            sportName: "Football",
            leagueName: String(competitionObj.name ?? competitionCode),
            leagueCountry: String(competitionObj.code ?? "INT"),
            kickoffAt,
            homeTeamName,
            awayTeamName,
            homeTeamCountry: String(homeTeamObj.tla ?? "INT"),
            awayTeamCountry: String(awayTeamObj.tla ?? "INT"),
            status: this.footballStatus(String(raw.status ?? "SCHEDULED")),
            homeScore: this.toNullableScore(fullTimeObj.home),
            awayScore: this.toNullableScore(fullTimeObj.away),
            refereeName,
            dataSource: provider.key
          });
          written += 1;
          competitionWritten += 1;
        }

        perCompetition.push({
          competitionCode,
          recordsRead: matches.length,
          recordsWritten: competitionWritten,
          errors: competitionErrors,
            ok: true,
            waitMs: throttle.waitedMs,
            retries: fetched.retries
        });
      } catch (error) {
        const durationMs = Date.now() - startedAt;
          const statusCode = error instanceof FootballDataHttpError ? error.status : 500;
          await this.logApiCall(
            `provider/${provider.key}/competitions/${competitionCode}/matches`,
            statusCode,
            durationMs,
            runId
          );
        const message = error instanceof Error ? error.message : "football_data fetch error";
        errors += 1;
          if (firstFailedCursorIndex === null) {
            firstFailedCursorIndex = absoluteCursorIndex;
          }
        perCompetition.push({
          competitionCode,
          recordsRead: 0,
          recordsWritten: 0,
          errors: 1,
          ok: false,
            waitMs: throttle.waitedMs,
            retries: 0,
          message
        });
      }
    }

      if (firstFailedCursorIndex !== null) {
        nextCursor = firstFailedCursorIndex;
      }

      await this.setCheckpoint(provider.key, checkpointEntityType, dateTo);
      if (jobType === "syncFixtures") {
        await this.setCheckpoint(provider.key, "football_matches", dateTo);
      }
      await this.setCheckpoint(provider.key, "football_matches_competition_cursor", String(nextCursor));
      await this.createExternalPayload(provider.key, runId, "football_data_matches", {
        competitionCodes,
        orderedCompetitionCodes,
        priorityCompetitionCodes: priorityCodes,
        selectedCompetitionCodes,
        deferredCompetitionCodes,
        perCompetition,
        dateFrom,
        dateTo,
        recordsRead,
        recordsWritten: written,
        errors,
        checkpointEntityType,
        checkpointCursorBefore: cursor,
        checkpointCursorAfter: nextCursor,
        rateLimit: {
          minuteRateLimit,
          minuteRateBuffer,
          minIntervalMs,
          maxCallsPerRun,
          retryMax
        },
        waitMs: totalWaitMs,
        retryCount: totalRetryCount,
        retryBackoffMs: totalRetryBackoffMs
      });

    return {
      providerKey: provider.key,
      recordsRead,
      recordsWritten: written,
      errors,
      details: {
        jobType,
        competitionCodes,
        orderedCompetitionCodes,
        priorityCompetitionCodes: priorityCodes,
        selectedCompetitionCodes,
        deferredCompetitionCodes,
        perCompetition,
        dateFrom,
        dateTo,
        checkpointEntityType,
        checkpointCursorBefore: cursor,
        checkpointCursorAfter: nextCursor,
        rateLimit: {
          minuteRateLimit,
          minuteRateBuffer,
          minIntervalMs,
          maxCallsPerRun,
          retryMax
        },
        waitMs: totalWaitMs,
        retryCount: totalRetryCount,
        retryBackoffMs: totalRetryBackoffMs
      }
    };
    } finally {
      await this.cache.releaseLock(lockKey, lockOwner);
    }
  }

  private async syncFootballDataStandings(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    settings: {
      apiKey?: string;
      baseUrl?: string;
      season?: string;
      competitionCode?: string;
      competitionCodes?: string[];
      priorityCompetitionCodes?: string[];
      minuteRateLimit?: number;
      minuteRateBuffer?: number;
      minIntervalMs?: number;
      maxCallsPerRun?: number;
      retryMax?: number;
    }
  ): Promise<ProviderSyncResult> {
    const lockKey = `provider-sync:${provider.key}`;
    const lockOwner = `${runId}:${Date.now()}`;
    const lockTtlMs = this.parseEnvInt("FOOTBALL_DATA_PROVIDER_LOCK_TTL_MS", 8 * 60 * 1000);
    const lockAcquired = await this.cache.acquireLock(lockKey, lockOwner, lockTtlMs);
    if (!lockAcquired) {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: "football_data standings senkronu baska bir worker tarafindan calisiyor. Bu run atlandi.",
          lockKey
        }
      };
    }

    try {
      const minuteRateLimit = this.parseConfigInt(
        settings.minuteRateLimit,
        this.parseEnvInt("FOOTBALL_DATA_RATE_LIMIT_PER_MINUTE", 10)
      );
      const minuteRateBuffer = this.parseConfigInt(
        settings.minuteRateBuffer,
        this.parseEnvInt("FOOTBALL_DATA_RATE_LIMIT_BUFFER", 1)
      );
      const minIntervalMs = this.parseConfigInt(
        settings.minIntervalMs,
        this.parseEnvInt("FOOTBALL_DATA_MIN_INTERVAL_MS", 7000)
      );
      const maxCallsPerRun = this.parseConfigInt(
        settings.maxCallsPerRun,
        this.parseEnvInt("FOOTBALL_DATA_MAX_CALLS_PER_RUN", 6)
      );
      const retryMax = this.parseConfigInt(
        settings.retryMax,
        this.parseEnvInt("FOOTBALL_DATA_RETRY_MAX", 2)
      );

      const rawCodes =
        settings.competitionCodes && settings.competitionCodes.length > 0
          ? settings.competitionCodes
          : [settings.competitionCode || "PL"];
      const competitionCodes = Array.from(
        new Set(
          rawCodes
            .map((code) => code.trim().toUpperCase())
            .filter((code) => code.length > 0)
        )
      );

      if (competitionCodes.length === 0) {
        return {
          providerKey: provider.key,
          recordsRead: 0,
          recordsWritten: 0,
          errors: 0,
          details: {
            message: "football_data standings competition code listesi bos oldugu icin senkron atlandi."
          }
        };
      }

      const rawPriorityCodes = settings.priorityCompetitionCodes ?? [];
      const priorityCodes = rawPriorityCodes
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code.length > 0 && competitionCodes.includes(code));
      const orderedCompetitionCodes = Array.from(new Set([...priorityCodes, ...competitionCodes]));

      const cursorEntityType = "football_standings_competition_cursor";
      const cursorRaw = await this.getCheckpoint(provider.key, cursorEntityType);
      const parsedCursor = Number(cursorRaw);
      const cursor =
        Number.isFinite(parsedCursor) && parsedCursor >= 0
          ? Math.floor(parsedCursor) % orderedCompetitionCodes.length
          : 0;

      const selectedCount = Math.min(Math.max(1, maxCallsPerRun), orderedCompetitionCodes.length);
      const selectedCompetitionCodes = Array.from(
        { length: selectedCount },
        (_, index) => orderedCompetitionCodes[(cursor + index) % orderedCompetitionCodes.length]
      );
      const selectedSet = new Set(selectedCompetitionCodes);
      const deferredCompetitionCodes = orderedCompetitionCodes.filter((code) => !selectedSet.has(code));
      let nextCursor = (cursor + selectedCount) % orderedCompetitionCodes.length;

      const seasonFilter = settings.season?.trim();
      let recordsRead = 0;
      let recordsWritten = 0;
      let errors = 0;
      let totalWaitMs = 0;
      let totalRetryCount = 0;
      let totalRetryBackoffMs = 0;
      let firstFailedCursorIndex: number | null = null;
      const perCompetition: Array<{
        competitionCode: string;
        recordsRead: number;
        recordsWritten: number;
        errors: number;
        ok: boolean;
        waitMs: number;
        retries: number;
        seasonLabel?: string | null;
        message?: string;
      }> = [];

      for (const [selectedIndex, competitionCode] of selectedCompetitionCodes.entries()) {
        const absoluteCursorIndex = (cursor + selectedIndex) % orderedCompetitionCodes.length;
        const throttle = await this.footballDataThrottle(
          provider.key,
          minuteRateLimit,
          minuteRateBuffer,
          minIntervalMs
        );
        totalWaitMs += throttle.waitedMs;

        const startedAt = Date.now();
        try {
          const fetched = await this.footballDataFetchStandingsWithRetry(
            settings.apiKey ?? "",
            competitionCode,
            seasonFilter,
            settings.baseUrl ?? provider.baseUrl ?? undefined,
            retryMax
          );
          totalRetryCount += fetched.retries;
          totalRetryBackoffMs += fetched.backoffMsTotal;
          const response = fetched.response;
          const durationMs = Date.now() - startedAt;
          await this.logApiCall(`provider/${provider.key}/competitions/${competitionCode}/standings`, 200, durationMs, runId);

          const competitionObj = this.toRecord(response.competition) ?? {};
          const seasonObj = this.toRecord(response.season) ?? {};
          const seasonStartDateRaw = String(seasonObj.startDate ?? "").trim();
          const seasonEndDateRaw = String(seasonObj.endDate ?? "").trim();
          const rows = this.extractFootballDataStandingsRows(response);
          recordsRead += rows.length;

          let competitionWritten = 0;
          let competitionErrors = 0;

          for (const row of rows) {
            const wrote = await this.upsertFootballDataStanding({
              providerId: provider.id,
              providerKey: provider.key,
              competitionCode,
              competitionName: String(competitionObj.name ?? competitionCode),
              competitionCountry: String(competitionObj.code ?? "INT"),
              seasonStartDate: seasonStartDateRaw.length > 0 ? seasonStartDateRaw : null,
              seasonEndDate: seasonEndDateRaw.length > 0 ? seasonEndDateRaw : null,
              row,
              dataSource: provider.key
            });
            if (wrote) {
              recordsWritten += 1;
              competitionWritten += 1;
            } else {
              errors += 1;
              competitionErrors += 1;
            }
          }

          perCompetition.push({
            competitionCode,
            recordsRead: rows.length,
            recordsWritten: competitionWritten,
            errors: competitionErrors,
            ok: true,
            waitMs: throttle.waitedMs,
            retries: fetched.retries,
            seasonLabel:
              seasonStartDateRaw.length > 0
                ? this.footballSeasonLabel(this.parseEventDate(seasonStartDateRaw) ?? new Date())
                : null
          });
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          const statusCode = error instanceof FootballDataHttpError ? error.status : 500;
          await this.logApiCall(
            `provider/${provider.key}/competitions/${competitionCode}/standings`,
            statusCode,
            durationMs,
            runId
          );
          const message = error instanceof Error ? error.message : "football_data standings fetch error";
          errors += 1;
          if (firstFailedCursorIndex === null) {
            firstFailedCursorIndex = absoluteCursorIndex;
          }
          perCompetition.push({
            competitionCode,
            recordsRead: 0,
            recordsWritten: 0,
            errors: 1,
            ok: false,
            waitMs: throttle.waitedMs,
            retries: 0,
            message
          });
        }
      }

      if (firstFailedCursorIndex !== null) {
        nextCursor = firstFailedCursorIndex;
      }

      const checkpointDate = this.todayDateString(0);
      await this.setCheckpoint(provider.key, "football_standings", checkpointDate);
      await this.setCheckpoint(provider.key, cursorEntityType, String(nextCursor));

      await this.createExternalPayload(provider.key, runId, "football_data_standings", {
        competitionCodes,
        orderedCompetitionCodes,
        priorityCompetitionCodes: priorityCodes,
        selectedCompetitionCodes,
        deferredCompetitionCodes,
        perCompetition,
        seasonFilter: seasonFilter ?? null,
        recordsRead,
        recordsWritten,
        errors,
        checkpointDate,
        checkpointCursorBefore: cursor,
        checkpointCursorAfter: nextCursor,
        rateLimit: {
          minuteRateLimit,
          minuteRateBuffer,
          minIntervalMs,
          maxCallsPerRun,
          retryMax
        },
        waitMs: totalWaitMs,
        retryCount: totalRetryCount,
        retryBackoffMs: totalRetryBackoffMs
      });

      return {
        providerKey: provider.key,
        recordsRead,
        recordsWritten,
        errors,
        details: {
          mode: "syncStandings",
          competitionCodes,
          orderedCompetitionCodes,
          selectedCompetitionCodes,
          deferredCompetitionCodes,
          seasonFilter: seasonFilter ?? null,
          checkpointCursorBefore: cursor,
          checkpointCursorAfter: nextCursor,
          perCompetition
        }
      };
    } finally {
      await this.cache.releaseLock(lockKey, lockOwner);
    }
  }

  private async syncTheSportsDb(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    const settings = await this.providersService.getProviderRuntimeSettings(provider.key);
    const apiKey = settings.apiKey;
    const soccerLeagueId = settings.soccerLeagueId || "4328";
    const basketballLeagueId = settings.basketballLeagueId || "4387";
    const baseUrl = settings.baseUrl ?? provider.baseUrl ?? undefined;
    const dailyLimit = settings.dailyLimit ?? 240;
    const enrichmentEnabled = this.parseBooleanConfig(settings.enrichmentEnabled, true);

    if (ENRICHMENT_JOB_TYPES.includes(jobType as (typeof ENRICHMENT_JOB_TYPES)[number]) && !enrichmentEnabled) {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: "TheSportsDB enrichment ayarlardan kapalı."
        }
      };
    }

    if (jobType === "resolveProviderAliases") {
      return this.resolveTheSportsDbAliases(provider, runId, {
        apiKey,
        baseUrl,
        soccerLeagueId,
        basketballLeagueId,
        dailyLimit
      });
    }

    if (jobType === "enrichTeamProfiles") {
      return this.enrichTheSportsDbTeamProfiles(provider, runId, {
        apiKey,
        baseUrl,
        soccerLeagueId,
        basketballLeagueId,
        dailyLimit
      });
    }

    if (jobType === "enrichMatchDetails") {
      return this.enrichTheSportsDbMatchDetails(provider, runId, {
        apiKey,
        baseUrl,
        dailyLimit,
        maxMatches: this.parseConfigInt(settings.matchDetailsMaxMatches, 20)
      });
    }

    if (jobType !== "syncFixtures" && jobType !== "syncResults") {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: `the_sports_db bu iş tipinde kullanılmıyor: ${jobType}`
        }
      };
    }

    const isResultsBackfill = jobType === "syncResults";
    const roundStart = this.toSafeRoundMax(settings.soccerRoundStart, 18);
    const roundMax = this.toSafeRoundMax(settings.soccerRoundMax, 60);
    const requestedRoundCalls = isResultsBackfill ? Math.max(0, roundMax - roundStart + 1) : 0;
    const plannedCalls = 2 + requestedRoundCalls;
    const quota = await this.quotaGate(provider.key, plannedCalls, dailyLimit);
    const remainingCalls = Number.isFinite(quota.remaining)
      ? Math.max(0, Math.floor(quota.remaining))
      : plannedCalls;
    const allowedRoundCalls = isResultsBackfill ? Math.max(0, Math.min(requestedRoundCalls, remainingCalls - 2)) : 0;

    if (remainingCalls < 2) {
      await this.logApiCall(`provider/${provider.key}/eventsnextleague`, 429, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          mode: isResultsBackfill ? "syncResults" : "syncFixtures",
          message: "TheSportsDB günlük kota nedeniyle senkron atlandı.",
          quota: {
            used: quota.used,
            remaining: quota.remaining,
            limit: quota.limit
          }
        }
      };
    }

    if (isResultsBackfill && allowedRoundCalls <= 0) {
      await this.logApiCall(`provider/${provider.key}/eventsround`, 429, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          mode: "syncResults",
          message: "TheSportsDB round-backfill kota nedeniyle bu çalışmada atlandı.",
          quota: {
            used: quota.used,
            remaining: quota.remaining,
            limit: quota.limit,
            requestedRoundCalls,
            allowedRoundCalls
          }
        }
      };
    }

    const startedAt = Date.now();
    const [soccer, basketball] = await Promise.all([
      this.theSportsDbConnector.fetchUpcomingSoccerEvents(apiKey, soccerLeagueId, baseUrl),
      this.theSportsDbConnector.fetchUpcomingBasketballEvents(apiKey, basketballLeagueId, baseUrl)
    ]);

    const soccerEvents = [...(soccer.events ?? [])];
    const basketballEvents = basketball.events ?? [];
    const soccerSeason = settings.soccerSeason || this.footballSeasonLabel(new Date());
    const backfillFromDate =
      this.parseIsoDateOnly(settings.soccerBackfillFrom) ?? new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const backfillToDate = new Date();
    const roundEnd = isResultsBackfill ? Math.min(roundMax, roundStart + allowedRoundCalls - 1) : roundStart - 1;
    let soccerRoundCalls = 0;
    let soccerRoundEventsRead = 0;
    let written = 0;
    let errors = 0;

    if (isResultsBackfill && allowedRoundCalls > 0) {
      let emptyStreak = 0;
      for (let round = roundStart; round <= roundEnd; round += 1) {
        if (emptyStreak >= 8) {
          break;
        }
        let roundResponse: { events?: Array<Record<string, unknown>> } = {};
        let fetched = false;
        let lastRoundError = "";
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            roundResponse = await this.theSportsDbConnector.fetchSoccerRoundEvents(
              apiKey,
              soccerLeagueId,
              soccerSeason,
              round,
              baseUrl
            );
            fetched = true;
            break;
          } catch (error) {
            const message = error instanceof Error ? error.message : "unknown round fetch error";
            lastRoundError = message;
            if (!message.includes("429")) {
              throw error;
            }
            await this.sleep(900 + attempt * 600);
          }
        }
        if (!fetched) {
          errors += 1;
          if (lastRoundError.includes("429")) {
            // Quota/rate limit reached: stop this batch early instead of hanging the run.
            break;
          }
          continue;
        }
        soccerRoundCalls += 1;
        const roundEvents = roundResponse.events ?? [];
        soccerRoundEventsRead += roundEvents.length;
        if (roundEvents.length === 0) {
          emptyStreak += 1;
          continue;
        }
        emptyStreak = 0;
        soccerEvents.push(...roundEvents);
        await this.sleep(250);
      }
    }

    const durationMs = Date.now() - startedAt;

    await this.logApiCall(
      `provider/${provider.key}/${isResultsBackfill ? "eventsround" : "eventsnextleague"}`,
      200,
      durationMs,
      runId
    );

    const uniqueSoccerEvents = Array.from(
      new Map(
        soccerEvents.map((event) => {
          const fallback = `${String(event.strHomeTeam ?? "").trim()}_${String(event.strAwayTeam ?? "").trim()}_${String(event.dateEvent ?? "").trim()}_${String(event.strTime ?? "").trim()}`;
          return [String(event.idEvent ?? fallback), event];
        })
      ).values()
    );

    const processEvent = async (
      event: Record<string, unknown>,
      fallbackSportCode: "football" | "basketball",
      dateFrom?: Date,
      dateTo?: Date
    ) => {
      const sportRaw = String(event.strSport ?? "").toLowerCase();
      const resolvedSportCode = sportRaw.includes("basket")
        ? "basketball"
        : sportRaw.includes("soccer") || sportRaw.includes("football")
          ? "football"
          : fallbackSportCode;
      const resolvedSportName = resolvedSportCode === "basketball" ? "Basketball" : "Football";
      const kickoffAt = this.parseEventDate(event.dateEvent, event.strTime);
      const homeTeamName = String(event.strHomeTeam ?? "").trim();
      const awayTeamName = String(event.strAwayTeam ?? "").trim();

      if (!kickoffAt || homeTeamName.length === 0 || awayTeamName.length === 0) {
        errors += 1;
        return;
      }
      if (dateFrom && kickoffAt < dateFrom) {
        return;
      }
      if (dateTo && kickoffAt > dateTo) {
        return;
      }

      const providerMatchKey = String(event.idEvent ?? `${resolvedSportCode}-${homeTeamName}-${awayTeamName}-${kickoffAt.toISOString()}`);
      const status =
        resolvedSportCode === "football"
          ? this.footballStatus(String(event.strStatus ?? "SCHEDULED"))
          : this.basketballStatus(String(event.strStatus ?? "Scheduled"));
      const refereeName = typeof event.strReferee === "string" && event.strReferee.trim().length > 0 ? String(event.strReferee) : null;

      await this.upsertMatchFromExternal({
        providerId: provider.id,
        providerKey: provider.key,
        providerMatchKey,
        sportCode: resolvedSportCode,
        sportName: resolvedSportName,
        leagueName: String(event.strLeague ?? (resolvedSportCode === "football" ? "Football" : "Basketball")),
        leagueCountry: "INT",
        kickoffAt,
        homeTeamName,
        awayTeamName,
        homeTeamCountry: "INT",
        awayTeamCountry: "INT",
        status,
        homeScore: this.toNullableScore(event.intHomeScore),
        awayScore: this.toNullableScore(event.intAwayScore),
        refereeName,
        dataSource: provider.key
      });
      written += 1;
    };

    for (const event of uniqueSoccerEvents) {
      if (isResultsBackfill) {
        await processEvent(event, "football", backfillFromDate, backfillToDate);
      } else {
        await processEvent(event, "football");
      }
    }

    for (const event of basketballEvents) {
      await processEvent(event, "basketball");
    }

    await this.createExternalPayload(provider.key, runId, "the_sports_db_events", {
      mode: isResultsBackfill ? "syncResults" : "syncFixtures",
      soccerLeagueId,
      basketballLeagueId,
      soccerSeason,
      soccerBackfillFrom: backfillFromDate.toISOString().slice(0, 10),
      soccerBackfillTo: backfillToDate.toISOString().slice(0, 10),
      soccerRoundStart: roundStart,
      soccerRoundEnd: roundEnd,
      requestedRoundCalls,
      allowedRoundCalls,
      soccerRoundCalls,
      soccerRoundEventsRead,
      recordsRead: uniqueSoccerEvents.length + basketballEvents.length,
      recordsWritten: written,
      errors,
      quota: {
        used: quota.used,
        remaining: quota.remaining,
        limit: quota.limit
      }
    });

    return {
      providerKey: provider.key,
      recordsRead: uniqueSoccerEvents.length + basketballEvents.length,
      recordsWritten: written,
      errors,
      details: {
        mode: isResultsBackfill ? "syncResults" : "syncFixtures",
        soccerLeagueId,
        basketballLeagueId,
        soccerSeason,
        soccerBackfillFrom: backfillFromDate.toISOString().slice(0, 10),
        soccerBackfillTo: backfillToDate.toISOString().slice(0, 10),
        soccerRoundStart: roundStart,
        soccerRoundEnd: roundEnd,
        requestedRoundCalls,
        allowedRoundCalls,
        soccerRoundCalls,
        soccerRoundEventsRead,
        quota: {
          used: quota.used,
          remaining: quota.remaining,
          limit: quota.limit
        }
      }
    };
  }

  private async fetchTheSportsDbLeagueTeams(
    provider: ProviderRecord,
    runId: string,
    options: {
      apiKey?: string;
      baseUrl?: string;
      leagueId: string;
    }
  ) {
    const startedAt = Date.now();
    try {
      const response = await this.theSportsDbConnector.fetchAllTeamsByLeague(options.apiKey, options.leagueId, options.baseUrl);
      const durationMs = Date.now() - startedAt;
      await this.logApiCall(`provider/${provider.key}/lookup_all_teams/${options.leagueId}`, 200, durationMs, runId);
      return response.teams ?? [];
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      await this.logApiCall(`provider/${provider.key}/lookup_all_teams/${options.leagueId}`, 500, durationMs, runId);
      throw error;
    }
  }

  private countryMatches(teamCountry: string | null | undefined, providerCountry: string) {
    const left = this.normalizeAlias(teamCountry ?? "");
    const right = this.normalizeAlias(providerCountry);
    if (left.length === 0 || right.length === 0) {
      return false;
    }
    return left === right || left.includes(right) || right.includes(left);
  }

  private async resolveTheSportsDbAliases(
    provider: ProviderRecord,
    runId: string,
    options: {
      apiKey?: string;
      baseUrl?: string;
      soccerLeagueId: string;
      basketballLeagueId: string;
      dailyLimit: number;
    }
  ): Promise<ProviderSyncResult> {
    const leagueIds = Array.from(
      new Set([options.soccerLeagueId, options.basketballLeagueId].map((item) => item.trim()).filter((item) => item.length > 0))
    );
    const quota = await this.quotaGate(provider.key, leagueIds.length, options.dailyLimit);
    if (!quota.allowed) {
      await this.logApiCall(`provider/${provider.key}/resolve-aliases`, 429, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 1,
        details: {
          message: "Günlük API kotası alias çözümleme için yetersiz.",
          dailyLimit: options.dailyLimit,
          plannedCalls: leagueIds.length,
          used: quota.used,
          remaining: quota.remaining
        }
      };
    }

    const teamPayloads = await Promise.all(
      leagueIds.map((leagueId) =>
        this.fetchTheSportsDbLeagueTeams(provider, runId, {
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          leagueId
        })
      )
    );

    const candidates = teamPayloads.flatMap((rows) =>
      rows.map((item) => this.parseTheSportsDbTeamCandidate(item)).filter((item): item is TheSportsDbTeamCandidate => item !== null)
    );

    const canonicalTeams = await this.prisma.team.findMany({
      select: {
        id: true,
        name: true,
        shortName: true,
        country: true,
        foundedYear: true
      }
    });

    const aliasIndex = new Map<string, Array<(typeof canonicalTeams)[number]>>();
    const pushAlias = (alias: string, team: (typeof canonicalTeams)[number]) => {
      const normalized = this.normalizeAlias(alias);
      if (normalized.length === 0) {
        return;
      }
      const bucket = aliasIndex.get(normalized) ?? [];
      bucket.push(team);
      aliasIndex.set(normalized, bucket);
    };
    for (const team of canonicalTeams) {
      pushAlias(team.name, team);
      if (team.shortName) {
        pushAlias(team.shortName, team);
      }
    }

    let recordsWritten = 0;
    let errors = 0;
    let createdTeams = 0;
    let updatedMappings = 0;
    let aliasWrites = 0;

    for (const candidate of candidates) {
      try {
        const aliases = this.toStringListUnique([
          candidate.strTeam,
          candidate.strTeamShort,
          ...this.splitAlternates(candidate.strAlternate)
        ]);

        const aliasMatches = aliases
          .map((alias) => aliasIndex.get(this.normalizeAlias(alias)) ?? [])
          .flat()
          .filter((item, index, self) => self.findIndex((team) => team.id === item.id) === index);
        const countryMatched = aliasMatches.find((team) => this.countryMatches(team.country, candidate.strCountry));
        let matchedTeam = countryMatched ?? aliasMatches[0] ?? null;
        let mappingConfidence = countryMatched ? 0.97 : aliasMatches.length > 0 ? 0.9 : 0.72;

        if (!matchedTeam) {
          matchedTeam = await this.prisma.team.create({
            data: {
              name: candidate.strTeam,
              shortName: candidate.strTeamShort,
              country: candidate.strCountry,
              foundedYear: candidate.intFormedYear,
              dataSource: provider.key,
              importedAt: new Date(),
              updatedByProcess: "the_sports_db_alias_resolution",
              dataQualityScore: 0.72
            }
          });
          createdTeams += 1;
          pushAlias(matchedTeam.name, matchedTeam);
          if (matchedTeam.shortName) {
            pushAlias(matchedTeam.shortName, matchedTeam);
          }
        } else {
          await this.prisma.team.update({
            where: { id: matchedTeam.id },
            data: {
              shortName: matchedTeam.shortName ?? candidate.strTeamShort ?? undefined,
              foundedYear: matchedTeam.foundedYear ?? candidate.intFormedYear ?? undefined,
              dataSource: provider.key,
              importedAt: new Date(),
              updatedByProcess: "the_sports_db_alias_resolution"
            }
          });
        }

        await this.prisma.providerTeamMapping.upsert({
          where: {
            providerId_providerTeamKey: {
              providerId: provider.id,
              providerTeamKey: candidate.idTeam
            }
          },
          update: {
            teamId: matchedTeam.id,
            mappingConfidence
          },
          create: {
            providerId: provider.id,
            teamId: matchedTeam.id,
            providerTeamKey: candidate.idTeam,
            mappingConfidence
          }
        });
        updatedMappings += 1;

        const normalizedNameCountryKey = this.normalizeKey(`${candidate.strTeam}_${candidate.strCountry}`);
        if (normalizedNameCountryKey.length > 0) {
          await this.prisma.providerTeamMapping.upsert({
            where: {
              providerId_providerTeamKey: {
                providerId: provider.id,
                providerTeamKey: normalizedNameCountryKey
              }
            },
            update: {
              teamId: matchedTeam.id,
              mappingConfidence: Math.max(0.84, mappingConfidence - 0.05)
            },
            create: {
              providerId: provider.id,
              teamId: matchedTeam.id,
              providerTeamKey: normalizedNameCountryKey,
              mappingConfidence: Math.max(0.84, mappingConfidence - 0.05)
            }
          });
        }

        for (const alias of aliases) {
          await this.upsertEntityAlias("team", matchedTeam.id, alias, mappingConfidence);
          aliasWrites += 1;
        }

        recordsWritten += 1;
      } catch (error) {
        errors += 1;
        this.logger.warn(
          `TheSportsDB alias resolution failed for ${candidate.idTeam}: ${
            error instanceof Error ? error.message : "unknown"
          }`
        );
      }
    }

    const cursor = new Date().toISOString();
    await this.setCheckpoint(provider.key, "the_sports_db_aliases", cursor);
    await this.createExternalPayload(provider.key, runId, "the_sports_db_aliases", {
      recordsRead: candidates.length,
      recordsWritten,
      createdTeams,
      updatedMappings,
      aliasWrites,
      errors,
      leagueIds
    });

    return {
      providerKey: provider.key,
      recordsRead: candidates.length,
      recordsWritten,
      errors,
      details: {
        jobType: "resolveProviderAliases",
        createdTeams,
        updatedMappings,
        aliasWrites,
        checkpoint: cursor
      }
    };
  }

  private async enrichTheSportsDbTeamProfiles(
    provider: ProviderRecord,
    runId: string,
    options: {
      apiKey?: string;
      baseUrl?: string;
      soccerLeagueId: string;
      basketballLeagueId: string;
      dailyLimit: number;
    }
  ): Promise<ProviderSyncResult> {
    const leagueIds = Array.from(
      new Set([options.soccerLeagueId, options.basketballLeagueId].map((item) => item.trim()).filter((item) => item.length > 0))
    );
    const quota = await this.quotaGate(provider.key, leagueIds.length, options.dailyLimit);
    if (!quota.allowed) {
      await this.logApiCall(`provider/${provider.key}/enrich-team-profiles`, 429, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 1,
        details: {
          message: "Günlük API kotası takım profil zenginleştirme için yetersiz.",
          dailyLimit: options.dailyLimit,
          plannedCalls: leagueIds.length,
          used: quota.used,
          remaining: quota.remaining
        }
      };
    }

    const teamPayloads = await Promise.all(
      leagueIds.map((leagueId) =>
        this.fetchTheSportsDbLeagueTeams(provider, runId, {
          apiKey: options.apiKey,
          baseUrl: options.baseUrl,
          leagueId
        })
      )
    );

    const candidates = teamPayloads.flatMap((rows) =>
      rows.map((item) => this.parseTheSportsDbTeamCandidate(item)).filter((item): item is TheSportsDbTeamCandidate => item !== null)
    );

    const mappings = await this.prisma.providerTeamMapping.findMany({
      where: { providerId: provider.id },
      select: {
        providerTeamKey: true,
        teamId: true,
        mappingConfidence: true
      }
    });

    const mappingByKey = new Map<string, { teamId: string; mappingConfidence: number | null }>();
    for (const mapping of mappings) {
      mappingByKey.set(mapping.providerTeamKey, {
        teamId: mapping.teamId,
        mappingConfidence: mapping.mappingConfidence
      });
    }

    let recordsWritten = 0;
    let errors = 0;
    let skipped = 0;

    for (const candidate of candidates) {
      try {
        const normalizedNameCountryKey = this.normalizeKey(`${candidate.strTeam}_${candidate.strCountry}`);
        const mapped = mappingByKey.get(candidate.idTeam) ?? mappingByKey.get(normalizedNameCountryKey);
        if (!mapped) {
          skipped += 1;
          continue;
        }

        await this.prisma.team.update({
          where: { id: mapped.teamId },
          data: {
            shortName: candidate.strTeamShort ?? undefined,
            foundedYear: candidate.intFormedYear ?? undefined,
            country: candidate.strCountry || undefined,
            dataSource: provider.key,
            importedAt: new Date(),
            updatedByProcess: "the_sports_db_team_profile_enrichment",
            dataQualityScore: mapped.mappingConfidence !== null ? Math.max(0.75, mapped.mappingConfidence) : undefined
          }
        });

        const aliases = this.toStringListUnique([
          candidate.strTeam,
          candidate.strTeamShort,
          ...this.splitAlternates(candidate.strAlternate)
        ]);
        for (const alias of aliases) {
          await this.upsertEntityAlias("team", mapped.teamId, alias, mapped.mappingConfidence ?? 0.84);
        }
        recordsWritten += 1;
      } catch (error) {
        errors += 1;
        this.logger.warn(
          `TheSportsDB team profile enrichment failed for ${candidate.idTeam}: ${
            error instanceof Error ? error.message : "unknown"
          }`
        );
      }
    }

    const cursor = new Date().toISOString();
    await this.setCheckpoint(provider.key, "the_sports_db_team_profiles", cursor);
    await this.createExternalPayload(provider.key, runId, "the_sports_db_team_profiles", {
      recordsRead: candidates.length,
      recordsWritten,
      skipped,
      errors,
      leagueIds
    });

    return {
      providerKey: provider.key,
      recordsRead: candidates.length,
      recordsWritten,
      errors,
      details: {
        jobType: "enrichTeamProfiles",
        skipped,
        checkpoint: cursor
      }
    };
  }

  private async enrichTheSportsDbMatchDetails(
    provider: ProviderRecord,
    runId: string,
    options: {
      apiKey?: string;
      baseUrl?: string;
      dailyLimit: number;
      maxMatches: number;
    }
  ): Promise<ProviderSyncResult> {
    const maxMatches = Math.max(5, Math.min(50, options.maxMatches));
    const now = new Date();
    const matches = await this.prisma.match.findMany({
      where: {
        sport: { code: "football" },
        matchDateTimeUTC: {
          gte: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000),
          lte: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000)
        },
        providerMappings: {
          some: {
            providerId: provider.id
          }
        }
      },
      include: {
        league: true,
        homeTeam: true,
        awayTeam: true,
        providerMappings: {
          where: { providerId: provider.id },
          select: {
            providerMatchKey: true,
            mappingConfidence: true
          }
        }
      },
      orderBy: { matchDateTimeUTC: "asc" },
      take: maxMatches
    });

    const callsPerMatch = 3;
    const plannedCalls = matches.length * callsPerMatch;
    const quota = await this.quotaGate(provider.key, plannedCalls, options.dailyLimit);
    let matchesToProcess = matches;
    let skippedByQuota = 0;
    if (!quota.allowed) {
      const remainingCalls = Number.isFinite(quota.remaining) ? Math.max(0, Math.floor(quota.remaining)) : 0;
      const allowedMatches = Math.floor(remainingCalls / callsPerMatch);
      if (allowedMatches <= 0) {
        await this.logApiCall(`provider/${provider.key}/enrich-match-details`, 429, 0, runId);
        return {
          providerKey: provider.key,
          recordsRead: matches.length,
          recordsWritten: 0,
          errors: 1,
          details: {
            message: "Günlük API kotası maç detay enrichment için yetersiz.",
            dailyLimit: options.dailyLimit,
            plannedCalls,
            used: quota.used,
            remaining: quota.remaining
          }
        };
      }

      matchesToProcess = matches.slice(0, allowedMatches);
      skippedByQuota = matches.length - matchesToProcess.length;
      await this.logApiCall(`provider/${provider.key}/enrich-match-details`, 206, 0, runId);
      this.logger.warn(
        `TheSportsDB match detail enrichment quota-limited. Processed ${matchesToProcess.length}/${matches.length} matches.`
      );
    }

    let recordsWritten = 0;
    let errors = 0;
    const detailSummaries: Array<Record<string, unknown>> = [];

    for (const match of matchesToProcess) {
      const mapping = match.providerMappings.find((item: { providerMatchKey: string }) => /^\d+$/.test(item.providerMatchKey));
      if (!mapping) {
        continue;
      }
      const eventId = mapping.providerMatchKey;

      let eventStats: Array<Record<string, unknown>> = [];
      let timeline: Array<Record<string, unknown>> = [];
      let refereeName: string | null = null;

      try {
        const startedEventAt = Date.now();
        const eventResponse = await this.theSportsDbConnector.lookupEvent(options.apiKey, eventId, options.baseUrl);
        await this.logApiCall(`provider/${provider.key}/lookupevent/${eventId}`, 200, Date.now() - startedEventAt, runId);
        const event = this.toRecordArray(eventResponse.events)[0];
        if (event) {
          refereeName = this.normalizeRefereeName(event.strReferee);
        }
      } catch (error) {
        errors += 1;
        await this.logApiCall(`provider/${provider.key}/lookupevent/${eventId}`, 500, 0, runId);
        this.logger.warn(`TheSportsDB event lookup failed for ${eventId}: ${error instanceof Error ? error.message : "unknown"}`);
      }

      try {
        const startedStatsAt = Date.now();
        const statsResponse = await this.theSportsDbConnector.lookupEventStats(options.apiKey, eventId, options.baseUrl);
        await this.logApiCall(`provider/${provider.key}/lookupeventstats/${eventId}`, 200, Date.now() - startedStatsAt, runId);
        eventStats = this.toRecordArray(statsResponse.eventstats);
      } catch (error) {
        errors += 1;
        await this.logApiCall(`provider/${provider.key}/lookupeventstats/${eventId}`, 500, 0, runId);
        this.logger.warn(`TheSportsDB event stats failed for ${eventId}: ${error instanceof Error ? error.message : "unknown"}`);
      }

      try {
        const startedTimelineAt = Date.now();
        const timelineResponse = await this.theSportsDbConnector.lookupTimeline(options.apiKey, eventId, options.baseUrl);
        await this.logApiCall(`provider/${provider.key}/lookuptimeline/${eventId}`, 200, Date.now() - startedTimelineAt, runId);
        timeline = this.toRecordArray(timelineResponse.timeline);
      } catch (error) {
        errors += 1;
        await this.logApiCall(`provider/${provider.key}/lookuptimeline/${eventId}`, 500, 0, runId);
        this.logger.warn(`TheSportsDB timeline failed for ${eventId}: ${error instanceof Error ? error.message : "unknown"}`);
      }

      const lineupSignals = timeline.filter((item) => {
        const token = `${String(item.strTimeline ?? "")} ${String(item.strTimelineDetail ?? "")}`.toLowerCase();
        return token.includes("lineup") || token.includes("starting") || token.includes("sub");
      }).length;
      const statsSignals = eventStats.filter((item) => {
        const token = `${String(item.strStat ?? "")} ${String(item.strHome ?? "")} ${String(item.strAway ?? "")}`.toLowerCase();
        return token.length > 0 && token !== "   ";
      }).length;

      const lineupCoverage = Number(Math.min(1, lineupSignals > 0 ? 0.45 + lineupSignals * 0.12 : timeline.length > 0 ? 0.32 : 0.18).toFixed(3));
      const eventStatsCoverage = Number(Math.min(1, statsSignals > 0 ? 0.35 + statsSignals * 0.08 : 0.2).toFixed(3));
      const aliasConfidence = Number((mapping.mappingConfidence ?? 0.6).toFixed(3));

      await this.matchContextEnrichment.upsertContext({
        matchId: match.id,
        kickoffAt: match.matchDateTimeUTC,
        sportCode: "football",
        leagueName: match.league.name,
        homeTeamName: match.homeTeam.name,
        awayTeamName: match.awayTeam.name,
        homeTeamCountry: match.homeTeam.country ?? "INT",
        awayTeamCountry: match.awayTeam.country ?? "INT",
        status: match.status,
        homeScore: match.homeScore,
        awayScore: match.awayScore,
        homeElo: match.homeElo,
        awayElo: match.awayElo,
        form5Home: match.form5Home,
        form5Away: match.form5Away,
        refereeName,
        source: "the_sports_db_match_details"
      });

      await this.applyContextPatchToFeatureSnapshot(match.id, {
        thesportsdbLineupCoverage: lineupCoverage,
        thesportsdbEventStatsCoverage: eventStatsCoverage,
        thesportsdbAliasConfidence: aliasConfidence,
        thesportsdbSignals: {
          timelineCount: timeline.length,
          lineupSignals,
          eventStatsCount: eventStats.length,
          statsSignals
        },
        thesportsdbUpdatedAt: new Date().toISOString()
      });

      detailSummaries.push({
        matchId: match.id,
        providerEventId: eventId,
        referee: refereeName ?? "missing",
        lineupCoverage,
        eventStatsCoverage,
        aliasConfidence
      });
      recordsWritten += 1;
    }

    const cursor = new Date().toISOString();
    await this.setCheckpoint(provider.key, "the_sports_db_match_details", cursor);
    await this.createExternalPayload(provider.key, runId, "the_sports_db_match_details", {
      recordsRead: matches.length,
      recordsWritten,
      errors,
      skippedByQuota,
      details: detailSummaries.slice(0, 30)
    });

    return {
      providerKey: provider.key,
      recordsRead: matches.length,
      recordsWritten,
      errors,
      details: {
        jobType: "enrichMatchDetails",
        processedMatches: matchesToProcess.length,
        skippedByQuota,
        checkpoint: cursor
      }
    };
  }

  private async syncBallDontLie(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    if (jobType !== "syncFixtures" && jobType !== "syncResults") {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: `ball_dont_lie bu iş tipinde kullanılmıyor: ${jobType}`
        }
      };
    }

    const settings = await this.providersService.getProviderRuntimeSettings(provider.key);
    if (!settings.apiKey || settings.apiKey.length === 0) {
      await this.logApiCall(`provider/${provider.key}/games`, 400, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: { message: "BALL_DONT_LIE_API_KEY eksik. Senkron atlandı." }
      };
    }

    const checkpoint = await this.getCheckpoint(provider.key, "basketball_games");
    const startDate = checkpoint || this.todayDateString(jobType === "syncResults" ? -7 : -3);
    const endDate = this.todayDateString(jobType === "syncResults" ? 1 : 7);

    const startedAt = Date.now();
    const response = await this.ballDontLieConnector.fetchGames(startDate, endDate, settings.apiKey, settings.baseUrl ?? provider.baseUrl ?? undefined);
    const durationMs = Date.now() - startedAt;

    await this.logApiCall(`provider/${provider.key}/games`, 200, durationMs, runId);

    const games = response.data ?? [];
    let written = 0;
    let errors = 0;

    for (const game of games) {
      const kickoffAt = this.parseEventDate(game.date);
      const homeTeamObj = (game.home_team as Record<string, unknown> | undefined) ?? {};
      const awayTeamObj = (game.visitor_team as Record<string, unknown> | undefined) ?? {};
      const homeTeamName = String(homeTeamObj.full_name ?? homeTeamObj.name ?? "").trim();
      const awayTeamName = String(awayTeamObj.full_name ?? awayTeamObj.name ?? "").trim();

      if (!kickoffAt || homeTeamName.length === 0 || awayTeamName.length === 0) {
        errors += 1;
        continue;
      }

      const providerMatchKey = String(game.id ?? `ball-${homeTeamName}-${awayTeamName}-${kickoffAt.toISOString()}`);
      await this.upsertMatchFromExternal({
        providerId: provider.id,
        providerKey: provider.key,
        providerMatchKey,
        sportCode: "basketball",
        sportName: "Basketball",
        leagueName: "NBA",
        leagueCountry: "USA",
        kickoffAt,
        homeTeamName,
        awayTeamName,
        homeTeamCountry: "USA",
        awayTeamCountry: "USA",
        status: this.basketballStatus(String(game.status ?? "Scheduled")),
        homeScore: this.toNullableScore(game.home_team_score),
        awayScore: this.toNullableScore(game.visitor_team_score),
        refereeName: null,
        dataSource: provider.key
      });
      written += 1;
    }

    await this.setCheckpoint(provider.key, "basketball_games", endDate);
    await this.createExternalPayload(provider.key, runId, "ball_dont_lie_games", {
      startDate,
      endDate,
      recordsRead: games.length,
      recordsWritten: written,
      errors
    });

    return {
      providerKey: provider.key,
      recordsRead: games.length,
      recordsWritten: written,
      errors,
      details: {
        jobType,
        startDate,
        endDate
      }
    };
  }

  private async syncApiFootball(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    if (jobType !== "syncFixtures" && jobType !== "syncResults") {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: `api_football bu iş tipinde kullanılmıyor: ${jobType}`
        }
      };
    }

    const settings = await this.providersService.getProviderRuntimeSettings(provider.key);
    if (!settings.apiKey || settings.apiKey.length === 0) {
      await this.logApiCall(`provider/${provider.key}/fixtures`, 400, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: { message: "API_FOOTBALL_API_KEY veya provider apiKey ayarı eksik. Senkron atlandı." }
      };
    }

    const dailyLimit = settings.dailyLimit ?? 100;
    const quota = await this.quotaGate(provider.key, 1, dailyLimit);
    if (!quota.allowed) {
      await this.logApiCall(`provider/${provider.key}/fixtures`, 429, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 1,
        details: {
          message: "Günlük API kotası aşıldı. Bu run atlandı.",
          dailyLimit,
          used: quota.used,
          remaining: quota.remaining
        }
      };
    }

    const dateOffset = jobType === "syncResults" ? -1 : 0;
    const targetDate = this.todayDateString(dateOffset);
    const startedAt = Date.now();
    const response = await this.apiFootballConnector.fetchFixtures(settings.apiKey, targetDate, settings.baseUrl ?? provider.baseUrl ?? undefined);
    const durationMs = Date.now() - startedAt;

    await this.logApiCall(`provider/${provider.key}/fixtures`, 200, durationMs, runId);

    const fixtures = response.response ?? [];
    const leagueFilter = settings.leagueId?.trim();
    const seasonFilter = settings.season?.trim();

    let written = 0;
    let errors = 0;

    for (const fixtureEntry of fixtures) {
      const fixture = (fixtureEntry.fixture as Record<string, unknown> | undefined) ?? {};
      const league = (fixtureEntry.league as Record<string, unknown> | undefined) ?? {};
      const teams = (fixtureEntry.teams as Record<string, unknown> | undefined) ?? {};
      const goals = (fixtureEntry.goals as Record<string, unknown> | undefined) ?? {};

      if (leagueFilter && String(league.id ?? "") !== leagueFilter) {
        continue;
      }
      if (seasonFilter && String(league.season ?? "") !== seasonFilter) {
        continue;
      }

      const homeTeamObj = (teams.home as Record<string, unknown> | undefined) ?? {};
      const awayTeamObj = (teams.away as Record<string, unknown> | undefined) ?? {};

      const kickoffAt = this.parseEventDate(fixture.date);
      const homeTeamName = String(homeTeamObj.name ?? "").trim();
      const awayTeamName = String(awayTeamObj.name ?? "").trim();

      if (!kickoffAt || homeTeamName.length === 0 || awayTeamName.length === 0) {
        errors += 1;
        continue;
      }

      const providerMatchKey = String(fixture.id ?? `api-football-${homeTeamName}-${awayTeamName}-${kickoffAt.toISOString()}`);
      const refereeName =
        typeof fixture.referee === "string" && String(fixture.referee).trim().length > 0
          ? String(fixture.referee)
          : null;
      await this.upsertMatchFromExternal({
        providerId: provider.id,
        providerKey: provider.key,
        providerMatchKey,
        sportCode: "football",
        sportName: "Football",
        leagueName: String(league.name ?? "Football"),
        leagueCountry: String(league.country ?? "INT"),
        kickoffAt,
        homeTeamName,
        awayTeamName,
        homeTeamCountry: "INT",
        awayTeamCountry: "INT",
        status: this.footballStatus(String((fixture.status as Record<string, unknown> | undefined)?.short ?? "SCHEDULED")),
        homeScore: this.toNullableScore(goals.home),
        awayScore: this.toNullableScore(goals.away),
        refereeName,
        dataSource: provider.key
      });
      written += 1;
    }

    await this.createExternalPayload(provider.key, runId, "api_football_fixtures", {
      targetDate,
      jobType,
      dailyLimit,
      leagueFilter: leagueFilter ?? null,
      seasonFilter: seasonFilter ?? null,
      recordsRead: fixtures.length,
      recordsWritten: written,
      errors
    });

    return {
      providerKey: provider.key,
      recordsRead: fixtures.length,
      recordsWritten: written,
      errors,
      details: {
        targetDate,
        jobType,
        dailyLimit,
        leagueFilter: leagueFilter ?? null,
        seasonFilter: seasonFilter ?? null
      }
    };
  }

  private async syncApiBasketball(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    if (jobType !== "syncFixtures" && jobType !== "syncResults") {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: `api_basketball bu iş tipinde kullanılmıyor: ${jobType}`
        }
      };
    }

    const settings = await this.providersService.getProviderRuntimeSettings(provider.key);
    if (!settings.apiKey || settings.apiKey.length === 0) {
      await this.logApiCall(`provider/${provider.key}/games`, 400, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: { message: "API_BASKETBALL_API_KEY veya provider apiKey ayarı eksik. Senkron atlandı." }
      };
    }

    const dailyLimit = settings.dailyLimit ?? 100;
    const quota = await this.quotaGate(provider.key, 1, dailyLimit);
    if (!quota.allowed) {
      await this.logApiCall(`provider/${provider.key}/games`, 429, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 1,
        details: {
          message: "Günlük API kotası aşıldı. Bu run atlandı.",
          dailyLimit,
          used: quota.used,
          remaining: quota.remaining
        }
      };
    }

    const dateOffset = jobType === "syncResults" ? -1 : 0;
    const targetDate = this.todayDateString(dateOffset);
    const startedAt = Date.now();
    const response = await this.apiBasketballConnector.fetchGames(
      settings.apiKey,
      targetDate,
      settings.baseUrl ?? provider.baseUrl ?? undefined
    );
    const durationMs = Date.now() - startedAt;

    await this.logApiCall(`provider/${provider.key}/games`, 200, durationMs, runId);

    const games = response.response ?? [];
    let written = 0;
    let errors = 0;

    for (const rawGame of games) {
      const game = rawGame ?? {};
      const league = (game.league as Record<string, unknown> | undefined) ?? {};
      const country = (game.country as Record<string, unknown> | undefined) ?? {};
      const teams = (game.teams as Record<string, unknown> | undefined) ?? {};
      const scores = (game.scores as Record<string, unknown> | undefined) ?? {};
      const status = (game.status as Record<string, unknown> | undefined) ?? {};

      const homeTeamObj = (teams.home as Record<string, unknown> | undefined) ?? {};
      const awayTeamObj = (teams.away as Record<string, unknown> | undefined) ?? {};
      const homeScores = (scores.home as Record<string, unknown> | undefined) ?? {};
      const awayScores = (scores.away as Record<string, unknown> | undefined) ?? {};

      const kickoffAt = this.parseEventDate(game.date);
      const homeTeamName = String(homeTeamObj.name ?? "").trim();
      const awayTeamName = String(awayTeamObj.name ?? "").trim();
      if (!kickoffAt || homeTeamName.length === 0 || awayTeamName.length === 0) {
        errors += 1;
        continue;
      }

      const providerMatchKey = String(game.id ?? `api-basketball-${homeTeamName}-${awayTeamName}-${kickoffAt.toISOString()}`);
      const statusRaw = String(status.long ?? status.short ?? "Scheduled");
      await this.upsertMatchFromExternal({
        providerId: provider.id,
        providerKey: provider.key,
        providerMatchKey,
        sportCode: "basketball",
        sportName: "Basketball",
        leagueName: String(league.name ?? "Basketball"),
        leagueCountry: String(country.name ?? "INT"),
        kickoffAt,
        homeTeamName,
        awayTeamName,
        homeTeamCountry: String(country.code ?? "INT"),
        awayTeamCountry: String(country.code ?? "INT"),
        status: this.basketballStatus(statusRaw),
        homeScore: this.toNullableScore(homeScores.total),
        awayScore: this.toNullableScore(awayScores.total),
        refereeName: null,
        dataSource: provider.key
      });
      written += 1;
    }

    await this.createExternalPayload(provider.key, runId, "api_basketball_games", {
      targetDate,
      jobType,
      dailyLimit,
      recordsRead: games.length,
      recordsWritten: written,
      errors
    });

    return {
      providerKey: provider.key,
      recordsRead: games.length,
      recordsWritten: written,
      errors,
      details: {
        targetDate,
        jobType,
        dailyLimit
      }
    };
  }

  private async syncApiNba(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    if (jobType !== "syncFixtures" && jobType !== "syncResults") {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: `api_nba bu iş tipinde kullanılmıyor: ${jobType}`
        }
      };
    }

    const settings = await this.providersService.getProviderRuntimeSettings(provider.key);
    if (!settings.apiKey || settings.apiKey.length === 0) {
      await this.logApiCall(`provider/${provider.key}/games`, 400, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: { message: "API_NBA_API_KEY veya provider apiKey ayarı eksik. Senkron atlandı." }
      };
    }

    const dailyLimit = settings.dailyLimit ?? 100;
    const quota = await this.quotaGate(provider.key, 1, dailyLimit);
    if (!quota.allowed) {
      await this.logApiCall(`provider/${provider.key}/games`, 429, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 1,
        details: {
          message: "Günlük API kotası aşıldı. Bu run atlandı.",
          dailyLimit,
          used: quota.used,
          remaining: quota.remaining
        }
      };
    }

    const dateOffset = jobType === "syncResults" ? -1 : 0;
    const targetDate = this.todayDateString(dateOffset);
    const startedAt = Date.now();
    const response = await this.apiNbaConnector.fetchGames(settings.apiKey, targetDate, settings.baseUrl ?? provider.baseUrl ?? undefined);
    const durationMs = Date.now() - startedAt;

    await this.logApiCall(`provider/${provider.key}/games`, 200, durationMs, runId);

    const games = response.response ?? [];
    const leagueFilter = settings.nbaLeague?.trim().toLowerCase();
    const seasonFilter = settings.season?.trim();

    let written = 0;
    let errors = 0;

    for (const rawGame of games) {
      const game = rawGame ?? {};
      const teams = (game.teams as Record<string, unknown> | undefined) ?? {};
      const scores = (game.scores as Record<string, unknown> | undefined) ?? {};
      const statusObj = (game.status as Record<string, unknown> | undefined) ?? {};
      const homeTeamObj = (teams.home as Record<string, unknown> | undefined) ?? {};
      const awayTeamObj = (teams.visitors as Record<string, unknown> | undefined) ?? {};
      const homeScoreObj = (scores.home as Record<string, unknown> | undefined) ?? {};
      const awayScoreObj = (scores.visitors as Record<string, unknown> | undefined) ?? {};
      const dateObj = (game.date as Record<string, unknown> | undefined) ?? {};

      const gameLeague = String(game.league ?? "").trim().toLowerCase();
      const gameSeason = String(game.season ?? "").trim();
      if (leagueFilter && gameLeague !== leagueFilter) {
        continue;
      }
      if (seasonFilter && gameSeason !== seasonFilter) {
        continue;
      }

      const kickoffAt = this.parseEventDate(dateObj.start);
      const homeTeamName = String(homeTeamObj.name ?? "").trim();
      const awayTeamName = String(awayTeamObj.name ?? "").trim();
      if (!kickoffAt || homeTeamName.length === 0 || awayTeamName.length === 0) {
        errors += 1;
        continue;
      }

      const shortStatus = String(statusObj.short ?? "").trim();
      const longStatus = String(statusObj.long ?? "").trim();
      const status =
        longStatus.length > 0
          ? this.basketballStatus(longStatus)
          : shortStatus === "3"
            ? MatchStatus.finished
            : shortStatus === "1" || shortStatus === "2"
              ? MatchStatus.live
              : MatchStatus.scheduled;

      const providerMatchKey = String(game.id ?? `api-nba-${homeTeamName}-${awayTeamName}-${kickoffAt.toISOString()}`);
      await this.upsertMatchFromExternal({
        providerId: provider.id,
        providerKey: provider.key,
        providerMatchKey,
        sportCode: "basketball",
        sportName: "Basketball",
        leagueName: "NBA",
        leagueCountry: "USA",
        kickoffAt,
        homeTeamName,
        awayTeamName,
        homeTeamCountry: "USA",
        awayTeamCountry: "USA",
        status,
        homeScore: this.toNullableScore(homeScoreObj.points),
        awayScore: this.toNullableScore(awayScoreObj.points),
        refereeName: null,
        dataSource: provider.key
      });
      written += 1;
    }

    await this.createExternalPayload(provider.key, runId, "api_nba_games", {
      targetDate,
      jobType,
      dailyLimit,
      leagueFilter: leagueFilter ?? null,
      seasonFilter: seasonFilter ?? null,
      recordsRead: games.length,
      recordsWritten: written,
      errors
    });

    return {
      providerKey: provider.key,
      recordsRead: games.length,
      recordsWritten: written,
      errors,
      details: {
        targetDate,
        jobType,
        dailyLimit,
        leagueFilter: leagueFilter ?? null,
        seasonFilter: seasonFilter ?? null
      }
    };
  }

  private async syncSportApi(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    const settings = await this.providersService.getProviderRuntimeSettings(provider.key);
    if (!settings.apiKey || settings.apiKey.length === 0) {
      await this.logApiCall(`provider/${provider.key}/fixtures`, 400, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: { message: "SPORTAPI_AI_API_KEY veya provider apiKey ayarı eksik. Senkron atlandı." }
      };
    }

    const dailyLimit = settings.dailyLimit ?? 1000;

    if (jobType === "syncLeagues") {
      const quota = await this.quotaGate(provider.key, 1, dailyLimit);
      if (!quota.allowed) {
        await this.logApiCall(`provider/${provider.key}/leagues`, 429, 0, runId);
        return {
          providerKey: provider.key,
          recordsRead: 0,
          recordsWritten: 0,
          errors: 1,
          details: {
            message: "Günlük API kotası aşıldı. syncLeagues atlandı.",
            dailyLimit,
            used: quota.used,
            remaining: quota.remaining
          }
        };
      }

      const startedAt = Date.now();
      const response = await this.sportApiConnector.fetchLeagues(settings.apiKey, settings.baseUrl ?? provider.baseUrl ?? undefined);
      const durationMs = Date.now() - startedAt;
      await this.logApiCall(`provider/${provider.key}/leagues`, 200, durationMs, runId);

      const groups = Array.isArray(response.data) ? response.data : [];
      const leagueCount = groups.reduce((acc, group) => acc + (Array.isArray(group.leagues) ? group.leagues.length : 0), 0);

      await this.createExternalPayload(provider.key, runId, "sportapi_leagues", {
        recordsRead: leagueCount,
        recordsWritten: 0,
        groups: groups.length
      });

      return {
        providerKey: provider.key,
        recordsRead: leagueCount,
        recordsWritten: 0,
        errors: 0,
        details: {
          mode: "syncLeagues",
          groups: groups.length,
          dailyLimit
        }
      };
    }

    if (jobType !== "syncFixtures" && jobType !== "syncResults") {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: {
          message: `sportapi_ai bu iş tipinde kullanılmıyor: ${jobType}`
        }
      };
    }

    const syncDaysBack = this.parseConfigInt(settings.syncDaysBack, 1);
    const syncDaysAhead = this.parseConfigInt(settings.syncDaysAhead, 1);
    const offsets =
      jobType === "syncResults"
        ? Array.from({ length: syncDaysBack + 1 }, (_, index) => index - syncDaysBack)
        : Array.from({ length: syncDaysAhead + 1 }, (_, index) => index);

    const quota = await this.quotaGate(provider.key, offsets.length, dailyLimit);
    if (!quota.allowed) {
      await this.logApiCall(`provider/${provider.key}/fixtures`, 429, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 1,
        details: {
          message: "Günlük API kotası bu run için yetersiz. Senkron atlandı.",
          dailyLimit,
          used: quota.used,
          remaining: quota.remaining,
          plannedCalls: offsets.length
        }
      };
    }

    let recordsRead = 0;
    let recordsWritten = 0;
    let errors = 0;

    for (const offset of offsets) {
      const targetDate = this.todayDateString(offset);
      const startedAt = Date.now();
      const response = await this.sportApiConnector.fetchFixturesByDate(
        settings.apiKey,
        targetDate,
        settings.baseUrl ?? provider.baseUrl ?? undefined
      );
      const durationMs = Date.now() - startedAt;
      await this.logApiCall(`provider/${provider.key}/fixtures/date/${targetDate}`, 200, durationMs, runId);

      const fixtures = Array.isArray(response.data) ? response.data : [];
      recordsRead += fixtures.length;

      for (const fixture of fixtures) {
        const fixtureRecord = this.toRecord(fixture);
        if (!fixtureRecord) {
          errors += 1;
          continue;
        }

        const dateValue = String(fixtureRecord.date ?? "").trim();
        const datetimeValue = String(fixtureRecord.datetime ?? "").trim();
        const normalizedDateTime =
          datetimeValue.length > 0 ? datetimeValue.replace(" ", "T").concat("Z") : dateValue.length > 0 ? dateValue : "";
        const kickoffAt = this.parseEventDate(normalizedDateTime || dateValue);
        const homeTeamName = String(fixtureRecord.home_team ?? "").trim();
        const awayTeamName = String(fixtureRecord.away_team ?? "").trim();
        if (!kickoffAt || homeTeamName.length === 0 || awayTeamName.length === 0) {
          errors += 1;
          continue;
        }

        const providerMatchKey = String(fixtureRecord.id ?? `sportapi-${homeTeamName}-${awayTeamName}-${kickoffAt.toISOString()}`);
        const refereeName = this.pickSportApiReferee(fixtureRecord);
        await this.upsertMatchFromExternal({
          providerId: provider.id,
          providerKey: provider.key,
          providerMatchKey,
          sportCode: "football",
          sportName: "Football",
          leagueName: String(fixtureRecord.league_name ?? "Football"),
          leagueCountry: String(fixtureRecord.league_zone ?? fixtureRecord.league_geo ?? "INT"),
          kickoffAt,
          homeTeamName,
          awayTeamName,
          homeTeamCountry: String(fixtureRecord.home_geo ?? "INT"),
          awayTeamCountry: String(fixtureRecord.away_geo ?? "INT"),
          status: this.footballStatus(String(fixtureRecord.status ?? "SCHEDULED")),
          homeScore: this.toNullableScore(fixtureRecord.home_score),
          awayScore: this.toNullableScore(fixtureRecord.away_score),
          refereeName,
          dataSource: provider.key
        });
        recordsWritten += 1;
      }
    }

    await this.createExternalPayload(provider.key, runId, "sportapi_fixtures", {
      mode: jobType,
      syncDaysBack,
      syncDaysAhead,
      offsets,
      recordsRead,
      recordsWritten,
      errors,
      dailyLimit
    });

    return {
      providerKey: provider.key,
      recordsRead,
      recordsWritten,
      errors,
      details: {
        mode: jobType,
        syncDaysBack,
        syncDaysAhead,
        calls: offsets.length,
        dailyLimit
      }
    };
  }
}

