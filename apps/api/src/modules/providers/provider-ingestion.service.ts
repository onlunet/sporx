import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AccessActorType, MatchStatus, PlayerAvailabilityStatus, Prisma, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { FootballDataConnector, FootballDataHttpError, FootballDataRateLimitMeta } from "./football-data.connector";
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
import { BasketballPredictionEngineService } from "../predictions/basketball/basketball-prediction-engine.service";
import { MatchContextEnrichmentService } from "./match-context-enrichment.service";
import { PredictionRunPublisherService } from "./prediction-run-publisher.service";
import { ModelAliasService } from "../predictions/model-alias.service";
import { IncidentReadinessService } from "../security-events/incident-readiness.service";
import { SecurityEventService } from "../security-events/security-event.service";
import {
  FootballCompetitionBucket,
  FootballCompetitionSignals,
  FootballSchedulerMode,
  deriveFootballRequestBudget,
  selectFootballCompetitionsForRun
} from "./football-data-optimization.util";

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

type TheSportsDbHalfTimeSource = "direct" | "timeline_derived" | "live_ht_score" | null;

type TheSportsDbHalfTimeRead = {
  home: number | null;
  away: number | null;
  source: TheSportsDbHalfTimeSource;
};

type TheSportsDbLeagueRunSummary = {
  leagueId: string;
  season: string;
  mode: "syncFixtures" | "syncResults";
  plannedCalls: number;
  attemptedCalls: number;
  successfulCalls: number;
  skippedDueQuota: number;
  eventsRead: number;
  matchesWritten: number;
  halfTimeScoresWritten: number;
  directHalfTimeScoresWritten: number;
  timelineHalfTimeScoresWritten: number;
  roundsAttempted: number;
  errors: string[];
  checkpointBefore: string | null;
  checkpointAfter: string | null;
};

type TheSportsDbCanonicalLineupPlayer = {
  playerName: string;
  position: string | null;
  jerseyNumber: number | null;
  availability: PlayerAvailabilityStatus;
  isStarter: boolean;
  sortOrder: number;
};

type TheSportsDbCanonicalLineupCandidate = {
  teamId: string;
  teamName: string;
  formation: string | null;
  players: TheSportsDbCanonicalLineupPlayer[];
  sourceUpdatedAt: Date | null;
  payload: Record<string, unknown>;
};

type TheSportsDbEventStatsProjection = {
  possession: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  fouls: number | null;
  corners: number | null;
  yellowCards: number | null;
  redCards: number | null;
  tempo: number | null;
  offenseScore: number | null;
  defenseScore: number | null;
  setPieceScore: number | null;
  transitionScore: number | null;
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
  halfTimeHomeScore?: number | null;
  halfTimeAwayScore?: number | null;
  q1HomeScore?: number | null;
  q1AwayScore?: number | null;
  q2HomeScore?: number | null;
  q2AwayScore?: number | null;
  q3HomeScore?: number | null;
  q3AwayScore?: number | null;
  q4HomeScore?: number | null;
  q4AwayScore?: number | null;
  homeElo?: number | null;
  awayElo?: number | null;
  form5Home?: number | null;
  form5Away?: number | null;
  refereeName?: string | null;
  dataSource: string;
};

type MatchUpsertResult = {
  id: string;
  kickoffAt: Date;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  halfTimeHomeScore: number | null;
  halfTimeAwayScore: number | null;
};

type PredictionPhase = "prematch" | "halftime" | "fulltime";

type PredictionPhaseTriggerCandidate = {
  phase: PredictionPhase;
  dedupKey: string;
  matchId: string;
  horizon: string;
  metadata: Record<string, unknown>;
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
    private readonly basketballPredictionEngine: BasketballPredictionEngineService,
    private readonly matchContextEnrichment: MatchContextEnrichmentService,
    private readonly predictionRunPublisher: PredictionRunPublisherService,
    private readonly modelAliasService: ModelAliasService,
    private readonly incidentReadinessService: IncidentReadinessService,
    private readonly securityEventService: SecurityEventService
  ) {}

  private isMissingPublishedPredictionsTableError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022") &&
      /published_predictions/i.test(error.message)
    ) {
      return true;
    }
    if (error instanceof Error && /published_predictions/i.test(error.message)) {
      return true;
    }
    return false;
  }

  private isMissingLegacyPredictionTableError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2021" || error.code === "P2022") &&
      /(prediction|predictionexplanation|prediction_explanation)/i.test(error.message)
    ) {
      return true;
    }
    if (error instanceof Error && /(prediction|predictionexplanation|prediction_explanation)/i.test(error.message)) {
      return true;
    }
    return false;
  }

  private isLegacyPredictionColumnCompatibilityError(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
      return true;
    }
    const message = error instanceof Error ? error.message : String(error);
    return (
      /(column|unknown arg|unknown field|does not exist)/i.test(message) &&
      /(prediction|predictionexplanation|prediction_explanation)/i.test(message)
    );
  }

  private async upsertLegacyPredictionCompatibility(input: {
    matchId: string;
    modelVersionId: string | null;
    probabilities: Record<string, unknown>;
    calibratedProbabilities: Record<string, unknown>;
    rawProbabilities: Record<string, unknown>;
    expectedScore: Record<string, unknown>;
    rawConfidenceScore: number;
    calibratedConfidenceScore: number;
    confidenceScore: number;
    summary: string;
    riskFlags: Array<{ code: string; severity: string; message: string }>;
    isRecommended: boolean;
    isLowConfidence: boolean;
    avoidReason: string | null;
  }) {
    const fullPredictionData = {
      modelVersionId: input.modelVersionId,
      probabilities: input.probabilities as Prisma.InputJsonValue,
      expectedScore: input.expectedScore as Prisma.InputJsonValue,
      rawProbabilities: input.rawProbabilities as Prisma.InputJsonValue,
      calibratedProbabilities: input.calibratedProbabilities as Prisma.InputJsonValue,
      rawConfidenceScore: input.rawConfidenceScore,
      calibratedConfidenceScore: input.calibratedConfidenceScore,
      confidenceScore: input.confidenceScore,
      summary: input.summary,
      riskFlags: input.riskFlags as Prisma.InputJsonValue,
      isRecommended: input.isRecommended,
      isLowConfidence: input.isLowConfidence,
      avoidReason: input.avoidReason,
      dataSource: "internal_prediction_engine",
      updatedByProcess: "generatePredictions"
    };
    const compatibilityPredictionData = {
      modelVersionId: input.modelVersionId,
      probabilities: input.probabilities as Prisma.InputJsonValue,
      expectedScore: input.expectedScore as Prisma.InputJsonValue,
      confidenceScore: input.confidenceScore,
      summary: input.summary,
      riskFlags: input.riskFlags as Prisma.InputJsonValue,
      avoidReason: input.avoidReason,
      dataSource: "internal_prediction_engine"
    };
    const explanationContent = {
      summary: input.summary,
      probabilities: input.probabilities,
      calibratedProbabilities: input.calibratedProbabilities,
      rawProbabilities: input.rawProbabilities,
      expectedScore: input.expectedScore,
      riskFlags: input.riskFlags,
      avoidReason: input.avoidReason,
      confidenceScore: input.confidenceScore,
      source: "internal_prediction_engine"
    } as Prisma.InputJsonValue;

    const persistPrediction = async (
      data: Prisma.PredictionUncheckedCreateInput | Prisma.PredictionUncheckedUpdateInput
    ) => {
      const existing = await this.prisma.prediction.findFirst({
        where: { matchId: input.matchId },
        orderBy: { updatedAt: "desc" },
        select: { id: true }
      });

      if (existing) {
        return this.prisma.prediction.update({
          where: { id: existing.id },
          data,
          select: { id: true }
        });
      }

      const createData: Prisma.PredictionUncheckedCreateInput = {
        ...(data as Prisma.PredictionUncheckedCreateInput),
        matchId: input.matchId
      };

      return this.prisma.prediction.create({
        data: createData,
        select: { id: true }
      });
    };

    try {
      let prediction: { id: string };
      try {
        prediction = await persistPrediction(fullPredictionData);
      } catch (error) {
        if (this.isLegacyPredictionColumnCompatibilityError(error)) {
          this.logger.warn(
            `legacy prediction compatibility path engaged for match ${input.matchId}; retrying with reduced payload.`
          );
          prediction = await persistPrediction(compatibilityPredictionData);
        } else {
          throw error;
        }
      }

      const existingExplanation = await this.prisma.predictionExplanation.findFirst({
        where: { predictionId: prediction.id },
        select: { id: true }
      });

      if (existingExplanation) {
        await this.prisma.predictionExplanation.update({
          where: { id: existingExplanation.id },
          data: { content: explanationContent }
        });
      } else {
        await this.prisma.predictionExplanation.create({
          data: {
            predictionId: prediction.id,
            content: explanationContent
          }
        });
      }
    } catch (error) {
      if (this.isMissingLegacyPredictionTableError(error)) {
        this.logger.warn(
          `legacy prediction tables missing; compatibility write skipped for match ${input.matchId}.`
        );
        return;
      }
      this.logger.warn(
        `legacy prediction compatibility write failed for match ${input.matchId}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }

  private supportsProviderFetch(jobType: string) {
    return [
      "syncFixtures",
      "syncFixturesHotPulse",
      "syncResults",
      "syncResultsReconcile",
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

  private collectPredictionScopeMatchIds(results: ProviderSyncResult[]) {
    const rawMatchIds = results.flatMap((item) => {
      const details = item.details ?? {};
      const matchIds = Array.isArray(details.matchIds) ? details.matchIds : [];
      return matchIds.map((matchId) => (typeof matchId === "string" ? matchId : null));
    });
    return this.uniqueStringList(rawMatchIds);
  }

  private parseDisabledProviderPaths(value: unknown) {
    if (!value) {
      return new Set<string>();
    }
    if (typeof value === "string") {
      return new Set(
        value
          .split(",")
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      );
    }
    if (Array.isArray(value)) {
      return new Set(value.map((item) => String(item).trim().toLowerCase()).filter(Boolean));
    }
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.providers)) {
        return new Set(record.providers.map((item) => String(item).trim().toLowerCase()).filter(Boolean));
      }
      if (typeof record.provider === "string") {
        return new Set([record.provider.trim().toLowerCase()]);
      }
    }
    return new Set<string>();
  }

  private clampNumeric(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private toNumber(value: unknown, fallback = 0) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
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
    let had429 = false;

    while (true) {
      try {
        const response = await this.footballDataConnector.fetchMatches(apiKey, competitionCode, dateFrom, dateTo, baseUrl);
        return {
          response,
          retries: attempt,
          backoffMsTotal,
          had429
        };
      } catch (error) {
        const shouldRetry =
          error instanceof FootballDataHttpError &&
          error.status === 429 &&
          attempt < retryMax;

        if (!shouldRetry) {
          throw error;
        }
        had429 = true;

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
    let had429 = false;

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
          backoffMsTotal,
          had429
        };
      } catch (error) {
        const shouldRetry =
          error instanceof FootballDataHttpError &&
          error.status === 429 &&
          attempt < retryMax;

        if (!shouldRetry) {
          throw error;
        }
        had429 = true;

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

    if (
      jobType === "syncFixtures" ||
      jobType === "syncFixturesHotPulse" ||
      jobType === "syncResults" ||
      jobType === "syncResultsReconcile"
    ) {
      await this.normalizeStaleMatchStatuses(runId);
    }

    const activeProviders = await this.providersService.listActiveApiProviders();
    const emergencyControls = await this.incidentReadinessService.getEmergencyControlStatus();
    const disabledProviders = this.parseDisabledProviderPaths(emergencyControls.disabledProviderPath);
    const results: ProviderSyncResult[] = [];

    for (const provider of activeProviders) {
      if (disabledProviders.has(provider.key.toLowerCase())) {
        await this.securityEventService.emitSecurityEvent({
          sourceDomain: SecurityEventSourceDomain.PROVIDER,
          eventType: "provider_path_blocked_by_emergency_control",
          severity: SecurityEventSeverity.HIGH,
          actorType: AccessActorType.SYSTEM,
          targetResourceType: "provider",
          targetResourceId: provider.key,
          reason: "disabled_provider_path",
          metadata: {
            providerKey: provider.key,
            jobType
          }
        });
        results.push({
          providerKey: provider.key,
          recordsRead: 0,
          recordsWritten: 0,
          errors: 0,
          details: {
            skipped: true,
            reason: "disabled_provider_path"
          }
        });
        continue;
      }

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

    const scopedPredictionMatchIds = this.collectPredictionScopeMatchIds(results);
    let predictionSummary: SyncSummary | null = null;
    if (
      (jobType === "syncFixtures" || jobType === "syncResults") &&
      summary.recordsWritten > 0 &&
      scopedPredictionMatchIds.length > 0
    ) {
      try {
        predictionSummary = await this.generatePredictions(runId, {
          matchIds: scopedPredictionMatchIds,
          reason: `post_${jobType}_scoped`
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "prediction_auto_generation_failed";
        this.logger.error(`Automatic prediction generation failed after ${jobType}: ${message}`);
      }
    }

    return {
      recordsRead: summary.recordsRead + (predictionSummary?.recordsRead ?? 0),
      recordsWritten: summary.recordsWritten + (predictionSummary?.recordsWritten ?? 0),
      errors: summary.errors + (predictionSummary?.errors ?? 0),
      logs: {
        providers: results,
        predictionGeneration: predictionSummary?.logs ?? null,
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

  private async generatePredictions(
    runId: string,
    options?: {
      matchIds?: string[];
      reason?: string;
    }
  ): Promise<SyncSummary> {
    const now = new Date();
    const riskTuningSettings = await this.loadPredictionRiskTuningSettings();
    const fromDate = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const toDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const scopedMatchIds = Array.from(
      new Set((options?.matchIds ?? []).map((item) => item.trim()).filter((item) => item.length > 0))
    );
    const isScopedRun = scopedMatchIds.length > 0;
    const matchSelect = {
      id: true,
      sportId: true,
      leagueId: true,
      homeTeamId: true,
      awayTeamId: true,
      status: true,
      matchDateTimeUTC: true,
      homeScore: true,
      awayScore: true,
      homeElo: true,
      awayElo: true,
      form5Home: true,
      form5Away: true
    } satisfies Prisma.MatchSelect;
    type ServingModelContext = {
      model: { id: string; modelName: string; version: string } | null;
      aliasType: string | null;
      resolvedViaAlias: boolean;
      calibrationVersionId: string | null;
      featureSetVersion: string | null;
      policyVersion: string | null;
      scopeLeagueKey: string | null;
    };

    const servingModelCache = new Map<string, ServingModelContext>();
    const resolveServingModel = async (input: {
      sportCode: string;
      market: string;
      horizon: string;
      leagueId?: string | null;
    }) => {
      const normalizedSport = input.sportCode.trim().toLowerCase();
      const normalizedMarket = input.market.trim().toLowerCase();
      const normalizedHorizon = input.horizon.trim().toUpperCase();
      const scopeLeagueKey = this.modelAliasService.scopeLeagueKey(input.leagueId ?? null);
      const cacheKey = `${normalizedSport}:${normalizedMarket}:na:${normalizedHorizon}:${scopeLeagueKey}`;
      const cached = servingModelCache.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }

      const resolved = await this.modelAliasService.resolveServingAlias({
        sport: normalizedSport,
        market: normalizedMarket,
        line: null,
        lineKey: "na",
        horizon: normalizedHorizon,
        leagueId: input.leagueId ?? null
      });

      const model = resolved.modelVersionId
        ? await this.prisma.modelVersion.findUnique({
            where: { id: resolved.modelVersionId },
            select: { id: true, modelName: true, version: true }
          })
        : null;
      const context: ServingModelContext = {
        model,
        aliasType: resolved.aliasType ?? null,
        resolvedViaAlias: resolved.resolvedViaAlias,
        calibrationVersionId: resolved.calibrationVersionId ?? null,
        featureSetVersion: resolved.featureSetVersion ?? null,
        policyVersion: resolved.policyVersion ?? null,
        scopeLeagueKey: resolved.scopeLeagueKey ?? null
      };
      servingModelCache.set(cacheKey, context);
      return context;
    };

    const activeServingModel = await resolveServingModel({
      sportCode: "football",
      market: "match_outcome",
      horizon: "POST_MATCH",
      leagueId: null
    });
    const activeModel = activeServingModel.model;

    const backfillPredictionFilters: Prisma.MatchWhereInput[] = activeModel?.id
      ? [
          {
            publishedPredictions: {
              none: {
                market: "match_outcome",
                lineKey: "na",
                horizon: "post_match"
              }
            }
          },
          {
            publishedPredictions: {
              some: {
                market: "match_outcome",
                lineKey: "na",
                horizon: "post_match",
                predictionRun: {
                  modelVersionId: { not: activeModel.id }
                }
              }
            }
          }
        ]
      : [
          {
            publishedPredictions: {
              none: {
                market: "match_outcome",
                lineKey: "na",
                horizon: "post_match"
              }
            }
          }
        ];

    const [upcomingCandidates, recentFinishedCandidates, backfillCandidates] = isScopedRun
      ? await Promise.all([
          this.prisma.match.findMany({
            where: { id: { in: scopedMatchIds } },
            select: matchSelect,
            orderBy: { matchDateTimeUTC: "asc" },
            take: Math.max(50, scopedMatchIds.length)
          }),
          Promise.resolve([] as Array<{
            id: string;
            sportId: string;
            leagueId: string;
            homeTeamId: string;
            awayTeamId: string;
            status: MatchStatus;
            matchDateTimeUTC: Date;
            homeScore: number | null;
            awayScore: number | null;
            homeElo: number | null;
            awayElo: number | null;
            form5Home: number | null;
            form5Away: number | null;
          }>),
          Promise.resolve([] as Array<{
            id: string;
            sportId: string;
            leagueId: string;
            homeTeamId: string;
            awayTeamId: string;
            status: MatchStatus;
            matchDateTimeUTC: Date;
            homeScore: number | null;
            awayScore: number | null;
            homeElo: number | null;
            awayElo: number | null;
            form5Home: number | null;
            form5Away: number | null;
          }>)
        ])
      : await Promise.all([
          this.prisma.match.findMany({
            where: {
              status: { in: [MatchStatus.scheduled, MatchStatus.live] },
              matchDateTimeUTC: { lte: toDate }
            },
            select: matchSelect,
            orderBy: { matchDateTimeUTC: "asc" },
            take: 1500
          }),
          this.prisma.match.findMany({
            where: {
              status: MatchStatus.finished,
              matchDateTimeUTC: { gte: fromDate, lte: now }
            },
            select: matchSelect,
            orderBy: { matchDateTimeUTC: "desc" },
            take: 600
          }),
          (async () => {
            try {
              return await this.prisma.match.findMany({
                where: {
                  OR: backfillPredictionFilters,
                  status: MatchStatus.finished,
                  matchDateTimeUTC: { lte: now }
                },
                select: matchSelect,
                orderBy: { matchDateTimeUTC: "desc" },
                take: 1000
              });
            } catch (error) {
              if (this.isMissingPublishedPredictionsTableError(error)) {
                this.logger.warn(
                  "published_predictions tablosu bulunamadı; backfill seçiminde published filtresi atlanıyor."
                );
                return [];
              }
              throw error;
            }
          })()
        ]);

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

    const rawCandidates = Array.from(candidateMap.values());
    if (rawCandidates.length === 0) {
      await this.createExternalPayload("internal_prediction_engine", runId, "generated_predictions", {
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0
      });
      await this.logApiCall("provider/internal_prediction_engine/generatePredictions", 200, 0, runId);
      return {
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        logs: {
          mode: "generatePredictions",
          reason: options?.reason ?? null,
          scopedMatchCount: scopedMatchIds.length > 0 ? scopedMatchIds.length : null,
          modelVersionId: activeModel?.id ?? null,
          modelName: activeModel?.modelName ?? null,
          modelVersion: activeModel?.version ?? null
        }
      };
    }

    const sportIds = Array.from(new Set(rawCandidates.map((candidate) => candidate.sportId)));
    const leagueIds = Array.from(new Set(rawCandidates.map((candidate) => candidate.leagueId)));
    const teamIds = Array.from(
      new Set(
        rawCandidates.flatMap((candidate) => [candidate.homeTeamId, candidate.awayTeamId])
      )
    );

    const [sports, leagues, teams] = await Promise.all([
      this.prisma.sport.findMany({
        where: { id: { in: sportIds } },
        select: { id: true, code: true, name: true }
      }),
      this.prisma.league.findMany({
        where: { id: { in: leagueIds } },
        select: { id: true, name: true, country: true }
      }),
      this.prisma.team.findMany({
        where: { id: { in: teamIds } },
        select: { id: true, name: true, country: true }
      })
    ]);

    const sportById = new Map(sports.map((sport) => [sport.id, sport] as const));
    const leagueById = new Map(leagues.map((league) => [league.id, league] as const));
    const teamById = new Map(teams.map((team) => [team.id, team] as const));
    const skippedMatches: string[] = [];

    const candidates = rawCandidates.flatMap((candidate) => {
      const sport = sportById.get(candidate.sportId);
      const league = leagueById.get(candidate.leagueId);
      const homeTeam = teamById.get(candidate.homeTeamId);
      const awayTeam = teamById.get(candidate.awayTeamId);

      if (!sport || !league || !homeTeam || !awayTeam) {
        skippedMatches.push(candidate.id);
        return [];
      }

      return [
        {
          ...candidate,
          sportCode: sport.code,
          leagueName: league.name,
          homeTeamName: homeTeam.name,
          awayTeamName: awayTeam.name,
          homeTeamCountry: homeTeam.country ?? "INT",
          awayTeamCountry: awayTeam.country ?? "INT"
        }
      ];
    });

    if (skippedMatches.length > 0) {
      this.logger.warn(
        `Prediction generation skipped ${skippedMatches.length} matches due to missing relation mapping`
      );
    }

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
        if (match.sportCode.toLowerCase() === "basketball") {
          const basketballServingModel = await resolveServingModel({
            sportCode: "basketball",
            market: "moneyline",
            horizon: "POST_MATCH",
            leagueId: match.leagueId
          });
          const basketball = await this.basketballPredictionEngine.compute({
            matchId: match.id,
            leagueId: match.leagueId,
            homeTeamId: match.homeTeamId,
            awayTeamId: match.awayTeamId,
            homeTeamName: match.homeTeamName,
            awayTeamName: match.awayTeamName,
            kickoffAt: match.matchDateTimeUTC,
            status: match.status,
            homeScore: match.homeScore,
            awayScore: match.awayScore,
            now
          });

          const calibratedBasketball = this.toRecord(basketball.calibratedProbabilities) ?? {};
          const homeWinProbability = this.toNumber(calibratedBasketball.home, 0.5);
          const awayWinProbability = this.toNumber(calibratedBasketball.away, 0.5);
          const pickProbability = Math.max(homeWinProbability, awayWinProbability);
          const selectedSide = homeWinProbability >= awayWinProbability ? "home" : "away";

          try {
            await this.predictionRunPublisher.publish({
              matchId: match.id,
              matchStatus: match.status,
              kickoffAt: match.matchDateTimeUTC,
              market: "moneyline",
              line: null,
              selection: selectedSide,
              modelVersionId: basketballServingModel.model?.id ?? null,
              probability: pickProbability,
              confidence: basketball.confidenceScore,
              riskFlags: basketball.riskFlags,
              explanation: {
                summary: basketball.summary,
                avoidReason: basketball.avoidReason,
                selectedSide,
                probabilities: basketball.calibratedProbabilities,
                calibratedProbabilities: basketball.calibratedProbabilities,
                rawProbabilities: basketball.rawProbabilities,
                expectedScore: basketball.expectedScore,
                isRecommended: basketball.isRecommended,
                isLowConfidence: basketball.isLowConfidence,
                serving: {
                  aliasType: basketballServingModel.aliasType,
                  resolvedViaAlias: basketballServingModel.resolvedViaAlias,
                  modelVersion: basketballServingModel.model?.version ?? null,
                  calibrationVersionId: basketballServingModel.calibrationVersionId,
                  featureSetVersion: basketballServingModel.featureSetVersion,
                  policyVersion: basketballServingModel.policyVersion,
                  scopeLeagueKey: basketballServingModel.scopeLeagueKey
                },
                dataSource: "generated"
              }
            });
          } catch (error) {
            this.logger.warn(
              `prediction_runs write skipped for basketball match ${match.id}: ${
                error instanceof Error ? error.message : "unknown"
              }`
            );
          }

          written += 1;
          continue;
        }

        const activeModelForMatch = await resolveServingModel({
          sportCode: "football",
          market: "match_outcome",
          horizon: "POST_MATCH",
          leagueId: match.leagueId
        });

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
            leagueName: match.leagueName,
            homeTeamName: match.homeTeamName,
            awayTeamName: match.awayTeamName,
            homeTeamCountry: match.homeTeamCountry,
            awayTeamCountry: match.awayTeamCountry,
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
          homeElo = this.teamRatingSeed(match.homeTeamName, match.homeTeamCountry, true);
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
          awayElo = this.teamRatingSeed(match.awayTeamName, match.awayTeamCountry, false);
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

        if (
          this.isAdvancedModel(
            activeModelForMatch.model
              ? { modelName: activeModelForMatch.model.modelName, version: activeModelForMatch.model.version }
              : null
          )
        ) {
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
              modelVersion: activeModelForMatch.model?.version ?? "elo_poisson_dc_v2",
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
        const hasLineupCoverage =
          (lineupCertaintyScore !== null && lineupCertaintyScore >= 0.55) ||
          (lineupCoverage !== null && lineupCoverage >= 0.4);

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

        const summary = `${match.homeTeamName} - ${match.awayTeamName}: Ev ${this.toPercent(
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

        const homeWinProbability = this.toNumber(calibratedProbabilities.home, 0.34);
        const drawProbability = this.toNumber(calibratedProbabilities.draw, 0.33);
        const awayWinProbability = this.toNumber(calibratedProbabilities.away, 0.33);
        const pickProbability = Math.max(homeWinProbability, drawProbability, awayWinProbability);

        await this.upsertLegacyPredictionCompatibility({
          matchId: match.id,
          modelVersionId: activeModelForMatch.model?.id ?? null,
          probabilities: calibratedProbabilities,
          calibratedProbabilities,
          rawProbabilities,
          expectedScore,
          rawConfidenceScore,
          calibratedConfidenceScore,
          confidenceScore,
          summary,
          riskFlags: uniqueRiskFlags,
          isRecommended: confidenceScore >= 0.6 && !isLowConfidence,
          isLowConfidence,
          avoidReason
        });

        try {
          const selectedSide =
            pickProbability === homeWinProbability
              ? "home"
              : pickProbability === drawProbability
                ? "draw"
                : "away";
          await this.predictionRunPublisher.publish({
            matchId: match.id,
            matchStatus: match.status,
            kickoffAt: match.matchDateTimeUTC,
            hasLineup: hasLineupCoverage,
            market: "match_outcome",
            line: null,
            selection: selectedSide,
            modelVersionId: activeModelForMatch.model?.id ?? null,
            probability: pickProbability,
            confidence: confidenceScore,
            riskFlags: uniqueRiskFlags,
            explanation: {
              summary,
              avoidReason,
              selectedSide,
              probabilities: calibratedProbabilities,
              calibratedProbabilities,
              rawProbabilities,
              expectedScore,
              isRecommended: confidenceScore >= 0.6 && !isLowConfidence,
              isLowConfidence,
              serving: {
                aliasType: activeModelForMatch.aliasType,
                resolvedViaAlias: activeModelForMatch.resolvedViaAlias,
                modelVersion: activeModelForMatch.model?.version ?? null,
                calibrationVersionId: activeModelForMatch.calibrationVersionId,
                featureSetVersion: activeModelForMatch.featureSetVersion,
                policyVersion: activeModelForMatch.policyVersion,
                scopeLeagueKey: activeModelForMatch.scopeLeagueKey
              },
              dataSource: "generated"
            }
          });
        } catch (error) {
          this.logger.warn(
            `prediction_runs write skipped for football match ${match.id}: ${
              error instanceof Error ? error.message : "unknown"
            }`
          );
        }

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
        reason: options?.reason ?? null,
        scopedMatchCount: scopedMatchIds.length > 0 ? scopedMatchIds.length : null,
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

  private addUtcDays(date: Date, offsetDays: number) {
    const next = new Date(date.getTime());
    next.setUTCDate(next.getUTCDate() + offsetDays);
    return next;
  }

  private toDateString(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private buildResultBackfillTargetDates(
    checkpoint: string | null,
    defaultDateFrom: string,
    dateTo: string,
    fallbackTargetDates: string[],
    maxDays: number
  ) {
    const checkpointDate = this.parseIsoDateOnly(checkpoint ?? undefined);
    const endDate = this.parseIsoDateOnly(dateTo);
    if (!checkpointDate || !endDate || this.toDateString(checkpointDate) >= defaultDateFrom) {
      return {
        targetDates: fallbackTargetDates,
        usedCheckpoint: false,
        nextCheckpoint: null as string | null
      };
    }

    const targetDates: string[] = [];
    let cursor = checkpointDate;
    const safeMaxDays = Math.max(1, Math.min(60, maxDays));
    while (cursor.getTime() <= endDate.getTime() && targetDates.length < safeMaxDays) {
      targetDates.push(this.toDateString(cursor));
      cursor = this.addUtcDays(cursor, 1);
    }

    return {
      targetDates: targetDates.length > 0 ? targetDates : fallbackTargetDates,
      usedCheckpoint: targetDates.length > 0,
      nextCheckpoint: targetDates.length > 0 ? this.toDateString(cursor) : null
    };
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
    try {
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
    } catch (error) {
      this.logger.warn(
        `Stale match status normalization skipped: ${error instanceof Error ? error.message : "unknown error"}`
      );
    }
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

  private uniqueStringList(values: Array<string | null | undefined>) {
    const result: string[] = [];
    const seen = new Set<string>();
    for (const value of values) {
      const token = String(value ?? "").trim();
      if (token.length === 0 || seen.has(token)) {
        continue;
      }
      seen.add(token);
      result.push(token);
    }
    return result;
  }

  private prioritizeTheSportsDbTurkeyLeague(leagueIds: string[]) {
    const turkeyLeagueId = "4339";
    const deduped = this.uniqueStringList(leagueIds);
    if (!deduped.includes(turkeyLeagueId)) {
      return [turkeyLeagueId, ...deduped];
    }
    return [turkeyLeagueId, ...deduped.filter((item) => item !== turkeyLeagueId)];
  }

  private theSportsDbSoccerLeagueIds(settings: { soccerLeagueId?: string; soccerLeagueIds?: string[] }) {
    if (settings.soccerLeagueIds && settings.soccerLeagueIds.length > 0) {
      return this.prioritizeTheSportsDbTurkeyLeague(settings.soccerLeagueIds);
    }
    return this.prioritizeTheSportsDbTurkeyLeague([settings.soccerLeagueId ?? "4339"]);
  }

  private theSportsDbBasketballLeagueIds(settings: { basketballLeagueId?: string; basketballLeagueIds?: string[] }) {
    if (settings.basketballLeagueIds && settings.basketballLeagueIds.length > 0) {
      return this.uniqueStringList(settings.basketballLeagueIds);
    }
    return this.uniqueStringList([settings.basketballLeagueId ?? "4387"]);
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

  private readFirstStringValue(record: Record<string, unknown> | null, keys: string[]) {
    if (!record) {
      return null;
    }
    for (const key of keys) {
      const value = record[key];
      if (typeof value !== "string") {
        continue;
      }
      const token = value.trim();
      if (token.length > 0) {
        return token;
      }
    }
    return null;
  }

  private parseRosterValue(value: unknown) {
    const rawEntries: string[] = [];
    if (Array.isArray(value)) {
      for (const entry of value) {
        if (typeof entry === "string") {
          rawEntries.push(entry);
          continue;
        }
        const record = this.toRecord(entry);
        if (!record) {
          continue;
        }
        const named =
          this.readFirstStringValue(record, ["name", "player", "strPlayer", "fullName", "displayName", "strPlayerName"]) ??
          null;
        if (named) {
          rawEntries.push(named);
        }
      }
    } else if (typeof value === "string") {
      const normalized = value.replace(/\r/g, "\n");
      const splitByPrimary = normalized.split(/[;\n|]+/g).map((item) => item.trim());
      if (splitByPrimary.filter((item) => item.length > 0).length <= 1) {
        rawEntries.push(...normalized.split(/\s*,\s*/g));
      } else {
        rawEntries.push(...splitByPrimary);
      }
    } else {
      const record = this.toRecord(value);
      if (record) {
        const named = this.readFirstStringValue(record, ["name", "player", "strPlayer", "fullName", "displayName"]);
        if (named) {
          rawEntries.push(named);
        }
      }
    }

    const output: Array<{ playerName: string; jerseyNumber: number | null }> = [];
    const seen = new Set<string>();
    for (const rawEntry of rawEntries) {
      const parsed = this.parsePlayerRosterEntry(rawEntry);
      if (!parsed) {
        continue;
      }
      const dedupKey = this.normalizeAlias(parsed.playerName);
      if (dedupKey.length === 0 || seen.has(dedupKey)) {
        continue;
      }
      seen.add(dedupKey);
      output.push(parsed);
    }

    return output;
  }

  private parsePlayerRosterEntry(rawEntry: string) {
    const compact = rawEntry.replace(/\s+/g, " ").trim();
    if (compact.length === 0) {
      return null;
    }
    if (["n/a", "none", "-", "null", "undefined", "tbc"].includes(compact.toLowerCase())) {
      return null;
    }

    const jerseyMatch = compact.match(/^#?(\d{1,2})[\.\-:\s]+(.+)$/);
    const jerseyNumber = jerseyMatch ? Number(jerseyMatch[1]) : null;
    let playerName = (jerseyMatch ? jerseyMatch[2] : compact)
      .replace(/\((c|captain|gk|goalkeeper|sub)\)/gi, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (playerName.length === 0) {
      return null;
    }

    const cleanupMatch = playerName.match(/^([^()]+)\((inj|out|susp|bench)\)$/i);
    if (cleanupMatch) {
      playerName = cleanupMatch[1].trim();
    }

    if (playerName.length < 2) {
      return null;
    }
    return { playerName, jerseyNumber };
  }

  private buildLineupPlayersFromTheSportsDb(
    event: Record<string, unknown> | null,
    side: "Home" | "Away",
    timeline: Array<Record<string, unknown>>,
    homeTeamName: string,
    awayTeamName: string
  ) {
    const players: TheSportsDbCanonicalLineupPlayer[] = [];
    const seen = new Set<string>();
    let sortOrder = 1;
    const sideLabel = side.toLowerCase();

    const pushEntries = (
      entries: Array<{ playerName: string; jerseyNumber: number | null }>,
      options: {
        position: string | null;
        availability: PlayerAvailabilityStatus;
        isStarter: boolean;
      }
    ) => {
      for (const entry of entries) {
        const dedupKey = this.normalizeAlias(entry.playerName);
        if (dedupKey.length === 0 || seen.has(dedupKey)) {
          continue;
        }
        seen.add(dedupKey);
        players.push({
          playerName: entry.playerName,
          jerseyNumber: entry.jerseyNumber,
          position: options.position,
          availability: options.availability,
          isStarter: options.isStarter,
          sortOrder
        });
        sortOrder += 1;
      }
    };

    const startersConfig: Array<{ keys: string[]; position: string }> = [
      {
        keys: [`str${side}LineupGoalkeeper`, `str${side}LineupGoalkeepers`, `${sideLabel}LineupGoalkeeper`],
        position: "Goalkeeper"
      },
      {
        keys: [`str${side}LineupDefense`, `str${side}LineupDefence`, `str${side}LineupDefenders`, `${sideLabel}LineupDefense`],
        position: "Defender"
      },
      {
        keys: [`str${side}LineupMidfield`, `str${side}LineupMidfielder`, `str${side}LineupMidfielders`, `${sideLabel}LineupMidfield`],
        position: "Midfielder"
      },
      {
        keys: [`str${side}LineupForward`, `str${side}LineupForwards`, `str${side}LineupAttack`, `${sideLabel}LineupForward`],
        position: "Forward"
      }
    ];

    for (const config of startersConfig) {
      for (const key of config.keys) {
        const entries = this.parseRosterValue(event?.[key]);
        if (entries.length === 0) {
          continue;
        }
        pushEntries(entries, {
          position: config.position,
          availability: PlayerAvailabilityStatus.AVAILABLE,
          isStarter: true
        });
      }
    }

    const benchKeys = [
      `str${side}LineupSubstitutes`,
      `str${side}LineupBench`,
      `${sideLabel}LineupSubstitutes`,
      `${sideLabel}LineupBench`
    ];
    for (const key of benchKeys) {
      const entries = this.parseRosterValue(event?.[key]);
      if (entries.length === 0) {
        continue;
      }
      pushEntries(entries, {
        position: "Substitute",
        availability: PlayerAvailabilityStatus.BENCH,
        isStarter: false
      });
    }

    const injuredKeys = [`str${side}LineupInjured`, `str${side}LineupUnavailable`, `str${side}Injuries`, `${sideLabel}LineupInjured`];
    for (const key of injuredKeys) {
      const entries = this.parseRosterValue(event?.[key]);
      if (entries.length === 0) {
        continue;
      }
      pushEntries(entries, {
        position: null,
        availability: PlayerAvailabilityStatus.OUT,
        isStarter: false
      });
    }

    const suspendedKeys = [`str${side}LineupSuspended`, `str${side}Suspended`, `${sideLabel}LineupSuspended`];
    for (const key of suspendedKeys) {
      const entries = this.parseRosterValue(event?.[key]);
      if (entries.length === 0) {
        continue;
      }
      pushEntries(entries, {
        position: null,
        availability: PlayerAvailabilityStatus.SUSPENDED,
        isStarter: false
      });
    }

    if (players.filter((row) => row.isStarter).length > 0) {
      return players;
    }

    const homeAlias = this.normalizeAlias(homeTeamName);
    const awayAlias = this.normalizeAlias(awayTeamName);
    const targetAlias = side === "Home" ? homeAlias : awayAlias;
    const oppositeAlias = side === "Home" ? awayAlias : homeAlias;
    for (const timelineItem of timeline) {
      const combined = `${String(timelineItem.strTimeline ?? "")} ${String(timelineItem.strTimelineDetail ?? "")}`.toLowerCase();
      if (!combined.includes("lineup") && !combined.includes("starting")) {
        continue;
      }
      const marker = this.normalizeAlias(
        `${String(timelineItem.strTeam ?? "")} ${String(timelineItem.strTimelineDetail ?? "")}`
      );
      if (targetAlias.length > 0 && marker.length > 0) {
        if (!marker.includes(targetAlias)) {
          if (marker.includes(oppositeAlias)) {
            continue;
          }
        }
      }
      const entry = this.parsePlayerRosterEntry(
        String(timelineItem.strPlayer ?? timelineItem.strPlayerIn ?? timelineItem.strTimelineDetail ?? "").trim()
      );
      if (!entry) {
        continue;
      }
      pushEntries([entry], {
        position: null,
        availability: PlayerAvailabilityStatus.AVAILABLE,
        isStarter: true
      });
    }

    return players;
  }

  private buildTheSportsDbCanonicalLineupCandidates(params: {
    providerEventId: string;
    homeTeamId: string;
    awayTeamId: string;
    homeTeamName: string;
    awayTeamName: string;
    event: Record<string, unknown> | null;
    timeline: Array<Record<string, unknown>>;
  }): TheSportsDbCanonicalLineupCandidate[] {
    const updatedAt =
      this.toDateOrNull(params.event?.dateUpdated) ??
      this.toDateOrNull(params.event?.strTimestamp) ??
      this.toDateOrNull(params.event?.dateEvent);
    const homeFormation =
      this.readFirstStringValue(params.event, ["strHomeFormation", "strHomeLineupFormation", "homeFormation"]) ?? null;
    const awayFormation =
      this.readFirstStringValue(params.event, ["strAwayFormation", "strAwayLineupFormation", "awayFormation"]) ?? null;

    const homePlayers = this.buildLineupPlayersFromTheSportsDb(
      params.event,
      "Home",
      params.timeline,
      params.homeTeamName,
      params.awayTeamName
    );
    const awayPlayers = this.buildLineupPlayersFromTheSportsDb(
      params.event,
      "Away",
      params.timeline,
      params.homeTeamName,
      params.awayTeamName
    );

    const candidates: TheSportsDbCanonicalLineupCandidate[] = [];
    if (homePlayers.length > 0) {
      candidates.push({
        teamId: params.homeTeamId,
        teamName: params.homeTeamName,
        formation: homeFormation,
        players: homePlayers,
        sourceUpdatedAt: updatedAt,
        payload: {
          providerEventId: params.providerEventId,
          side: "home",
          formation: homeFormation,
          players: homePlayers
        }
      });
    }
    if (awayPlayers.length > 0) {
      candidates.push({
        teamId: params.awayTeamId,
        teamName: params.awayTeamName,
        formation: awayFormation,
        players: awayPlayers,
        sourceUpdatedAt: updatedAt,
        payload: {
          providerEventId: params.providerEventId,
          side: "away",
          formation: awayFormation,
          players: awayPlayers
        }
      });
    }
    return candidates;
  }

  private async persistTheSportsDbCanonicalLineups(params: {
    provider: ProviderRecord;
    matchId: string;
    providerEventId: string;
    homeTeamId: string;
    awayTeamId: string;
    homeTeamName: string;
    awayTeamName: string;
    event: Record<string, unknown> | null;
    timeline: Array<Record<string, unknown>>;
  }) {
    const candidates = this.buildTheSportsDbCanonicalLineupCandidates({
      providerEventId: params.providerEventId,
      homeTeamId: params.homeTeamId,
      awayTeamId: params.awayTeamId,
      homeTeamName: params.homeTeamName,
      awayTeamName: params.awayTeamName,
      event: params.event,
      timeline: params.timeline
    });
    if (candidates.length === 0) {
      return { lineupRowsWritten: 0, lineupPlayersWritten: 0 };
    }

    const now = new Date();
    let lineupRowsWritten = 0;
    let lineupPlayersWritten = 0;

    for (const candidate of candidates) {
      const lineupHash = this.hashPayload({
        providerEventId: params.providerEventId,
        teamId: candidate.teamId,
        formation: candidate.formation,
        players: candidate.players.map((player) => ({
          n: player.playerName,
          p: player.position,
          j: player.jerseyNumber,
          a: player.availability,
          s: player.isStarter,
          o: player.sortOrder
        }))
      });
      const existing = await this.prisma.canonicalLineup.findFirst({
        where: {
          matchId: params.matchId,
          teamId: candidate.teamId,
          providerKey: params.providerEventId,
          lineupHash
        },
        select: { id: true }
      });
      if (existing) {
        continue;
      }

      const roster = await this.prisma.player.findMany({
        where: { teamId: candidate.teamId },
        select: { id: true, fullName: true }
      });
      const rosterMap = new Map<string, string>();
      for (const player of roster) {
        const key = this.normalizeAlias(player.fullName);
        if (key.length === 0 || rosterMap.has(key)) {
          continue;
        }
        rosterMap.set(key, player.id);
      }

      const createdLineup = await this.prisma.canonicalLineup.create({
        data: {
          matchId: params.matchId,
          teamId: candidate.teamId,
          providerId: params.provider.id,
          providerKey: params.providerEventId,
          formation: candidate.formation,
          sourceUpdatedAt: candidate.sourceUpdatedAt,
          pulledAt: now,
          lineupHash,
          payloadJson: {
            provider: params.provider.key,
            providerEventId: params.providerEventId,
            teamId: candidate.teamId,
            teamName: candidate.teamName,
            formation: candidate.formation,
            payload: candidate.payload
          } as Prisma.InputJsonValue
        }
      });
      lineupRowsWritten += 1;

      if (candidate.players.length > 0) {
        const createManyRows = candidate.players.map((player) => ({
          canonicalLineupId: createdLineup.id,
          playerId: rosterMap.get(this.normalizeAlias(player.playerName)) ?? null,
          playerName: player.playerName,
          position: player.position,
          jerseyNumber: player.jerseyNumber,
          availability: player.availability,
          isStarter: player.isStarter,
          sortOrder: player.sortOrder
        }));
        await this.prisma.canonicalLineupPlayerAvailability.createMany({
          data: createManyRows
        });
        lineupPlayersWritten += createManyRows.length;
      }
    }

    return { lineupRowsWritten, lineupPlayersWritten };
  }

  private parseTheSportsDbStatNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value !== "string") {
      return null;
    }
    const compact = value.trim();
    if (compact.length === 0) {
      return null;
    }
    const ratioMatch = compact.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)$/);
    if (ratioMatch) {
      const numerator = Number(ratioMatch[1]);
      const denominator = Number(ratioMatch[2]);
      if (Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0) {
        return (numerator / denominator) * 100;
      }
      return null;
    }
    const normalized = compact.replace(/%/g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  }

  private normalizeTheSportsDbStatLabel(value: unknown) {
    if (typeof value !== "string") {
      return "";
    }
    return this.normalizeAlias(value);
  }

  private buildTheSportsDbEventStatsProjection(eventStats: Array<Record<string, unknown>>) {
    const home: TheSportsDbEventStatsProjection = {
      possession: null,
      shots: null,
      shotsOnTarget: null,
      fouls: null,
      corners: null,
      yellowCards: null,
      redCards: null,
      tempo: null,
      offenseScore: null,
      defenseScore: null,
      setPieceScore: null,
      transitionScore: null
    };
    const away: TheSportsDbEventStatsProjection = {
      possession: null,
      shots: null,
      shotsOnTarget: null,
      fouls: null,
      corners: null,
      yellowCards: null,
      redCards: null,
      tempo: null,
      offenseScore: null,
      defenseScore: null,
      setPieceScore: null,
      transitionScore: null
    };

    const assign = (field: keyof TheSportsDbEventStatsProjection, homeValue: number | null, awayValue: number | null) => {
      if (homeValue !== null) {
        home[field] = homeValue;
      }
      if (awayValue !== null) {
        away[field] = awayValue;
      }
    };

    for (const row of eventStats) {
      const label = this.normalizeTheSportsDbStatLabel(row.strStat ?? row.stat ?? row.strType);
      if (label.length === 0) {
        continue;
      }
      const homeValue = this.parseTheSportsDbStatNumber(row.strHome ?? row.home ?? row.intHome ?? row.homeValue);
      const awayValue = this.parseTheSportsDbStatNumber(row.strAway ?? row.away ?? row.intAway ?? row.awayValue);
      if (homeValue === null && awayValue === null) {
        continue;
      }

      if (label.includes("possession")) {
        assign("possession", homeValue, awayValue);
        continue;
      }
      if (
        label.includes("shots_on_target") ||
        label.includes("shots_on_goal") ||
        label.includes("shots_target") ||
        label.includes("shots_on")
      ) {
        assign("shotsOnTarget", homeValue, awayValue);
        continue;
      }
      if (
        label.includes("total_shots") ||
        label.includes("shots_total") ||
        (label.includes("shot") && !label.includes("target"))
      ) {
        assign("shots", homeValue, awayValue);
        continue;
      }
      if (label.includes("foul")) {
        assign("fouls", homeValue, awayValue);
        continue;
      }
      if (label.includes("corner")) {
        assign("corners", homeValue, awayValue);
        continue;
      }
      if (label.includes("yellow")) {
        assign("yellowCards", homeValue, awayValue);
        continue;
      }
      if (label.includes("red")) {
        assign("redCards", homeValue, awayValue);
      }
    }

    const finalizeTeam = (own: TheSportsDbEventStatsProjection, opp: TheSportsDbEventStatsProjection) => {
      const shotsOnTarget = own.shotsOnTarget ?? 0;
      const shots = own.shots ?? 0;
      const corners = own.corners ?? 0;
      own.tempo = own.possession !== null ? Number((0.7 + own.possession / 100).toFixed(3)) : null;
      own.offenseScore = Number((shotsOnTarget * 0.35 + shots * 0.08 + corners * 0.06).toFixed(3));
      own.defenseScore = Number((Math.max(0, 10 - (opp.shotsOnTarget ?? 0) * 0.7 - (opp.shots ?? 0) * 0.05)).toFixed(3));
      own.setPieceScore = Number((corners * 0.28).toFixed(3));
      own.transitionScore = Number((Math.max(0, (shots - corners) * 0.1 + shotsOnTarget * 0.2)).toFixed(3));
    };

    finalizeTeam(home, away);
    finalizeTeam(away, home);

    return { home, away };
  }

  private optionalFloat(value: number | null) {
    return value === null ? undefined : Number(value.toFixed(3));
  }

  private optionalInt(value: number | null) {
    return value === null ? undefined : Math.max(0, Math.round(value));
  }

  private hasAnyProjectedStat(value: TheSportsDbEventStatsProjection) {
    return (
      value.possession !== null ||
      value.shots !== null ||
      value.shotsOnTarget !== null ||
      value.fouls !== null ||
      value.corners !== null ||
      value.yellowCards !== null ||
      value.redCards !== null
    );
  }

  private async persistTheSportsDbTeamStats(params: {
    matchId: string;
    homeTeamId: string;
    awayTeamId: string;
    eventStats: Array<Record<string, unknown>>;
  }) {
    if (params.eventStats.length === 0) {
      return 0;
    }

    const projection = this.buildTheSportsDbEventStatsProjection(params.eventStats);
    if (!this.hasAnyProjectedStat(projection.home) && !this.hasAnyProjectedStat(projection.away)) {
      return 0;
    }

    const now = new Date();
    await Promise.all([
      this.prisma.teamStat.upsert({
        where: {
          matchId_teamId: {
            matchId: params.matchId,
            teamId: params.homeTeamId
          }
        },
        update: {
          possession: this.optionalFloat(projection.home.possession),
          shots: this.optionalInt(projection.home.shots),
          shotsOnTarget: this.optionalInt(projection.home.shotsOnTarget),
          fouls: this.optionalInt(projection.home.fouls),
          corners: this.optionalInt(projection.home.corners),
          yellowCards: this.optionalInt(projection.home.yellowCards),
          redCards: this.optionalInt(projection.home.redCards),
          tempo: this.optionalFloat(projection.home.tempo),
          offenseScore: this.optionalFloat(projection.home.offenseScore),
          defenseScore: this.optionalFloat(projection.home.defenseScore),
          setPieceScore: this.optionalFloat(projection.home.setPieceScore),
          transitionScore: this.optionalFloat(projection.home.transitionScore),
          dataSource: "the_sports_db_eventstats",
          importedAt: now
        },
        create: {
          matchId: params.matchId,
          teamId: params.homeTeamId,
          possession: this.optionalFloat(projection.home.possession),
          shots: this.optionalInt(projection.home.shots),
          shotsOnTarget: this.optionalInt(projection.home.shotsOnTarget),
          fouls: this.optionalInt(projection.home.fouls),
          corners: this.optionalInt(projection.home.corners),
          yellowCards: this.optionalInt(projection.home.yellowCards),
          redCards: this.optionalInt(projection.home.redCards),
          tempo: this.optionalFloat(projection.home.tempo),
          offenseScore: this.optionalFloat(projection.home.offenseScore),
          defenseScore: this.optionalFloat(projection.home.defenseScore),
          setPieceScore: this.optionalFloat(projection.home.setPieceScore),
          transitionScore: this.optionalFloat(projection.home.transitionScore),
          dataSource: "the_sports_db_eventstats",
          importedAt: now
        }
      }),
      this.prisma.teamStat.upsert({
        where: {
          matchId_teamId: {
            matchId: params.matchId,
            teamId: params.awayTeamId
          }
        },
        update: {
          possession: this.optionalFloat(projection.away.possession),
          shots: this.optionalInt(projection.away.shots),
          shotsOnTarget: this.optionalInt(projection.away.shotsOnTarget),
          fouls: this.optionalInt(projection.away.fouls),
          corners: this.optionalInt(projection.away.corners),
          yellowCards: this.optionalInt(projection.away.yellowCards),
          redCards: this.optionalInt(projection.away.redCards),
          tempo: this.optionalFloat(projection.away.tempo),
          offenseScore: this.optionalFloat(projection.away.offenseScore),
          defenseScore: this.optionalFloat(projection.away.defenseScore),
          setPieceScore: this.optionalFloat(projection.away.setPieceScore),
          transitionScore: this.optionalFloat(projection.away.transitionScore),
          dataSource: "the_sports_db_eventstats",
          importedAt: now
        },
        create: {
          matchId: params.matchId,
          teamId: params.awayTeamId,
          possession: this.optionalFloat(projection.away.possession),
          shots: this.optionalInt(projection.away.shots),
          shotsOnTarget: this.optionalInt(projection.away.shotsOnTarget),
          fouls: this.optionalInt(projection.away.fouls),
          corners: this.optionalInt(projection.away.corners),
          yellowCards: this.optionalInt(projection.away.yellowCards),
          redCards: this.optionalInt(projection.away.redCards),
          tempo: this.optionalFloat(projection.away.tempo),
          offenseScore: this.optionalFloat(projection.away.offenseScore),
          defenseScore: this.optionalFloat(projection.away.defenseScore),
          setPieceScore: this.optionalFloat(projection.away.setPieceScore),
          transitionScore: this.optionalFloat(projection.away.transitionScore),
          dataSource: "the_sports_db_eventstats",
          importedAt: now
        }
      })
    ]);

    return 2;
  }

  private parseTimelineMinute(row: Record<string, unknown>) {
    const directKeys = ["intTime", "minute", "intMinute", "elapsed", "intElapsed"];
    for (const key of directKeys) {
      const value = Number(row[key]);
      if (Number.isFinite(value) && value >= 0 && value <= 200) {
        return Math.round(value);
      }
    }
    const textCandidates = [row.strTimeline, row.strTimelineDetail, row.strEvent];
    for (const candidate of textCandidates) {
      if (typeof candidate !== "string") {
        continue;
      }
      const match = candidate.match(/(\d{1,3})\s*'?/);
      if (!match) {
        continue;
      }
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 200) {
        return Math.round(parsed);
      }
    }
    return null;
  }

  private inferTheSportsDbTimelineTeamId(
    row: Record<string, unknown>,
    homeTeamId: string,
    awayTeamId: string,
    homeTeamName: string,
    awayTeamName: string
  ) {
    const homeAlias = this.normalizeAlias(homeTeamName);
    const awayAlias = this.normalizeAlias(awayTeamName);
    const tokens = [
      row.strTeam,
      row.strTimelineTeam,
      row.strTeamName,
      row.strHomeTeam,
      row.strAwayTeam,
      row.strSide,
      row.strTimelineDetail
    ]
      .map((value) => (typeof value === "string" ? this.normalizeAlias(value) : ""))
      .filter((value) => value.length > 0);

    for (const token of tokens) {
      const hasHome = homeAlias.length > 0 && token.includes(homeAlias);
      const hasAway = awayAlias.length > 0 && token.includes(awayAlias);
      if (hasHome && !hasAway) {
        return homeTeamId;
      }
      if (hasAway && !hasHome) {
        return awayTeamId;
      }
    }
    return null;
  }

  private parseTimelineEventType(row: Record<string, unknown>) {
    const direct = this.readFirstStringValue(row, ["strTimeline", "strEvent", "strType", "event", "type"]);
    if (!direct) {
      return null;
    }
    const compact = direct.replace(/\s+/g, " ").trim();
    return compact.length > 0 ? compact.slice(0, 80) : null;
  }

  private parseTimelinePlayerName(row: Record<string, unknown>) {
    const direct =
      this.readFirstStringValue(row, ["strPlayer", "strPlayerIn", "strPlayerOut", "player", "playerName"]) ?? null;
    if (direct) {
      const parsed = this.parsePlayerRosterEntry(direct);
      return parsed?.playerName ?? null;
    }
    const detail = this.readFirstStringValue(row, ["strTimelineDetail", "detail"]);
    if (!detail || detail.length > 48) {
      return null;
    }
    const parsed = this.parsePlayerRosterEntry(detail);
    return parsed?.playerName ?? null;
  }

  private async persistTheSportsDbTimelineEvents(params: {
    matchId: string;
    homeTeamId: string;
    awayTeamId: string;
    homeTeamName: string;
    awayTeamName: string;
    timeline: Array<Record<string, unknown>>;
  }) {
    if (params.timeline.length === 0) {
      return 0;
    }

    const now = new Date();
    const createRows: Prisma.MatchEventCreateManyInput[] = [];
    const seen = new Set<string>();

    for (const row of params.timeline) {
      const eventType = this.parseTimelineEventType(row);
      if (!eventType) {
        continue;
      }
      const minute = this.parseTimelineMinute(row);
      const teamId = this.inferTheSportsDbTimelineTeamId(
        row,
        params.homeTeamId,
        params.awayTeamId,
        params.homeTeamName,
        params.awayTeamName
      );
      const playerName = this.parseTimelinePlayerName(row);
      const signature = `${eventType}|${minute ?? "na"}|${teamId ?? "na"}|${playerName ?? "na"}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      createRows.push({
        matchId: params.matchId,
        minute,
        eventType,
        teamId,
        playerId: null,
        payload: {
          provider: "the_sports_db",
          timelineRow: row,
          playerName
        } as Prisma.InputJsonValue,
        dataSource: "the_sports_db_timeline",
        importedAt: now,
        updatedByProcess: "provider_sync"
      });
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.matchEvent.deleteMany({
        where: {
          matchId: params.matchId,
          dataSource: "the_sports_db_timeline"
        }
      });
      if (createRows.length > 0) {
        await tx.matchEvent.createMany({
          data: createRows
        });
      }
    });

    return createRows.length;
  }

  private async persistTheSportsDbEnrichment(params: {
    provider: ProviderRecord;
    matchId: string;
    providerEventId: string;
    homeTeamId: string;
    awayTeamId: string;
    homeTeamName: string;
    awayTeamName: string;
    event: Record<string, unknown> | null;
    eventStats: Array<Record<string, unknown>>;
    timeline: Array<Record<string, unknown>>;
  }) {
    const [lineupResult, teamStatsUpserted, timelineEventsWritten] = await Promise.all([
      this.persistTheSportsDbCanonicalLineups({
        provider: params.provider,
        matchId: params.matchId,
        providerEventId: params.providerEventId,
        homeTeamId: params.homeTeamId,
        awayTeamId: params.awayTeamId,
        homeTeamName: params.homeTeamName,
        awayTeamName: params.awayTeamName,
        event: params.event,
        timeline: params.timeline
      }),
      this.persistTheSportsDbTeamStats({
        matchId: params.matchId,
        homeTeamId: params.homeTeamId,
        awayTeamId: params.awayTeamId,
        eventStats: params.eventStats
      }),
      this.persistTheSportsDbTimelineEvents({
        matchId: params.matchId,
        homeTeamId: params.homeTeamId,
        awayTeamId: params.awayTeamId,
        homeTeamName: params.homeTeamName,
        awayTeamName: params.awayTeamName,
        timeline: params.timeline
      })
    ]);

    return {
      lineupRowsWritten: lineupResult.lineupRowsWritten,
      lineupPlayersWritten: lineupResult.lineupPlayersWritten,
      teamStatsUpserted,
      timelineEventsWritten
    };
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

  private hasHalfTimePair(homeScore: number | null | undefined, awayScore: number | null | undefined) {
    return homeScore !== null && homeScore !== undefined && awayScore !== null && awayScore !== undefined;
  }

  private hasQuarterPair(homeScore: number | null | undefined, awayScore: number | null | undefined) {
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
      halfTimeHomeScore: number | null;
      halfTimeAwayScore: number | null;
      q1HomeScore: number | null;
      q1AwayScore: number | null;
      q2HomeScore: number | null;
      q2AwayScore: number | null;
      q3HomeScore: number | null;
      q3AwayScore: number | null;
      q4HomeScore: number | null;
      q4AwayScore: number | null;
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
    const incomingHasHalfTime = this.hasHalfTimePair(input.halfTimeHomeScore, input.halfTimeAwayScore);
    const existingHasHalfTime = this.hasHalfTimePair(existing?.halfTimeHomeScore, existing?.halfTimeAwayScore);

    let status = normalizedIncomingStatus;
    let homeScore = input.homeScore;
    let awayScore = input.awayScore;
    let halfTimeHomeScore = input.halfTimeHomeScore ?? null;
    let halfTimeAwayScore = input.halfTimeAwayScore ?? null;
    let q1HomeScore = input.q1HomeScore ?? null;
    let q1AwayScore = input.q1AwayScore ?? null;
    let q2HomeScore = input.q2HomeScore ?? null;
    let q2AwayScore = input.q2AwayScore ?? null;
    let q3HomeScore = input.q3HomeScore ?? null;
    let q3AwayScore = input.q3AwayScore ?? null;
    let q4HomeScore = input.q4HomeScore ?? null;
    let q4AwayScore = input.q4AwayScore ?? null;
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

    if (existingHasHalfTime && !incomingHasHalfTime) {
      halfTimeHomeScore = existing!.halfTimeHomeScore;
      halfTimeAwayScore = existing!.halfTimeAwayScore;
    } else if (existingHasHalfTime && incomingHasHalfTime) {
      const halfTimeDiffers =
        existing!.halfTimeHomeScore !== input.halfTimeHomeScore || existing!.halfTimeAwayScore !== input.halfTimeAwayScore;
      if (halfTimeDiffers) {
        const incomingPriority = this.providerReliabilityScore(input.dataSource);
        const existingPriority = this.providerReliabilityScore(existing!.dataSource);
        if (existingPriority > incomingPriority) {
          halfTimeHomeScore = existing!.halfTimeHomeScore;
          halfTimeAwayScore = existing!.halfTimeAwayScore;
        }
      }
    }

    const quarterPairs = [
      {
        key: "q1",
        incomingHome: input.q1HomeScore ?? null,
        incomingAway: input.q1AwayScore ?? null,
        existingHome: existing?.q1HomeScore ?? null,
        existingAway: existing?.q1AwayScore ?? null
      },
      {
        key: "q2",
        incomingHome: input.q2HomeScore ?? null,
        incomingAway: input.q2AwayScore ?? null,
        existingHome: existing?.q2HomeScore ?? null,
        existingAway: existing?.q2AwayScore ?? null
      },
      {
        key: "q3",
        incomingHome: input.q3HomeScore ?? null,
        incomingAway: input.q3AwayScore ?? null,
        existingHome: existing?.q3HomeScore ?? null,
        existingAway: existing?.q3AwayScore ?? null
      },
      {
        key: "q4",
        incomingHome: input.q4HomeScore ?? null,
        incomingAway: input.q4AwayScore ?? null,
        existingHome: existing?.q4HomeScore ?? null,
        existingAway: existing?.q4AwayScore ?? null
      }
    ] as const;

    const incomingPriority = this.providerReliabilityScore(input.dataSource);
    const existingPriority = this.providerReliabilityScore(existing?.dataSource);

    for (const pair of quarterPairs) {
      const incomingHasQuarter = this.hasQuarterPair(pair.incomingHome, pair.incomingAway);
      const existingHasQuarter = this.hasQuarterPair(pair.existingHome, pair.existingAway);
      let resolvedHome = pair.incomingHome;
      let resolvedAway = pair.incomingAway;

      if (existingHasQuarter && !incomingHasQuarter) {
        resolvedHome = pair.existingHome;
        resolvedAway = pair.existingAway;
      } else if (existingHasQuarter && incomingHasQuarter) {
        const differs = pair.existingHome !== pair.incomingHome || pair.existingAway !== pair.incomingAway;
        if (differs && existingPriority > incomingPriority) {
          resolvedHome = pair.existingHome;
          resolvedAway = pair.existingAway;
        }
      }

      if (pair.key === "q1") {
        q1HomeScore = resolvedHome;
        q1AwayScore = resolvedAway;
      } else if (pair.key === "q2") {
        q2HomeScore = resolvedHome;
        q2AwayScore = resolvedAway;
      } else if (pair.key === "q3") {
        q3HomeScore = resolvedHome;
        q3AwayScore = resolvedAway;
      } else {
        q4HomeScore = resolvedHome;
        q4AwayScore = resolvedAway;
      }
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
      halfTimeHomeScore,
      halfTimeAwayScore,
      q1HomeScore,
      q1AwayScore,
      q2HomeScore,
      q2AwayScore,
      q3HomeScore,
      q3AwayScore,
      q4HomeScore,
      q4AwayScore,
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

  private parseScorePair(value: unknown) {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim();
    if (normalized.length === 0) {
      return null;
    }

    const match = normalized.match(/(\d+)\s*[-:]\s*(\d+)/);
    if (!match) {
      return null;
    }

    const home = this.toNullableScore(match[1]);
    const away = this.toNullableScore(match[2]);
    if (home === null || away === null) {
      return null;
    }

    return { home, away };
  }

  private readHalfTimeScorePair(row: Record<string, unknown>) {
    const directHome = this.readHalfTimeScore(row, "home");
    const directAway = this.readHalfTimeScore(row, "away");
    if (directHome !== null && directAway !== null) {
      return { home: directHome, away: directAway };
    }

    const nestedCandidates = [
      row.halfTime,
      row.halftime,
      row.half_time,
      row.ht,
      row.ht_score,
      row.htScore,
      row.firstHalf,
      row.first_half,
      row.firstHalfScore,
      row.first_half_score
    ];

    for (const candidate of nestedCandidates) {
      const nested = this.toRecord(candidate);
      if (!nested) {
        continue;
      }
      const nestedHome = this.toNullableScore(nested.home) ?? this.readHalfTimeScore(nested, "home");
      const nestedAway = this.toNullableScore(nested.away) ?? this.readHalfTimeScore(nested, "away");
      if (nestedHome !== null && nestedAway !== null) {
        return { home: nestedHome, away: nestedAway };
      }
    }

    const stringCandidates = [
      row.strHTScore,
      row.strHalfTime,
      row.strHalfScore,
      row.half_time_score,
      row.halftime_score,
      row.ht_score
    ];

    for (const candidate of stringCandidates) {
      const parsed = this.parseScorePair(candidate);
      if (parsed) {
        return parsed;
      }
    }

    return {
      home: directHome,
      away: directAway
    };
  }

  private readTheSportsDbDirectHalfTimeScore(event: Record<string, unknown>): TheSportsDbHalfTimeRead {
    const direct = this.readHalfTimeScorePair(event);
    if (this.hasHalfTimePair(direct.home, direct.away)) {
      return {
        home: direct.home,
        away: direct.away,
        source: "direct"
      };
    }

    const progress = String(event.strProgress ?? event.strStatus ?? "").trim().toUpperCase();
    const currentHome = this.toNullableScore(event.intHomeScore);
    const currentAway = this.toNullableScore(event.intAwayScore);
    if ((progress === "HT" || progress.includes("HALF TIME") || progress.includes("HALFTIME")) && this.hasScorePair(currentHome, currentAway)) {
      return {
        home: currentHome,
        away: currentAway,
        source: "live_ht_score"
      };
    }

    return {
      home: direct.home,
      away: direct.away,
      source: null
    };
  }

  private parseTimelineGoalMinute(value: unknown) {
    const token = String(value ?? "").trim();
    if (token.length === 0) {
      return null;
    }

    const match = token.match(/(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
    if (!match) {
      return null;
    }

    const base = Number(match[1]);
    const stoppage = match[2] ? Number(match[2]) : 0;
    if (!Number.isFinite(base) || !Number.isFinite(stoppage)) {
      return null;
    }

    return { base, stoppage };
  }

  private timelineMinuteIsFirstHalf(minute: { base: number; stoppage: number } | null) {
    if (!minute) {
      return false;
    }
    if (minute.base < 45) {
      return true;
    }
    return minute.base === 45;
  }

  private isGoalTimelineEvent(row: Record<string, unknown>) {
    const token = [
      row.strTimeline,
      row.strTimelineDetail,
      row.strEvent,
      row.type,
      row.event,
      row.detail
    ]
      .map((item) => String(item ?? "").toLowerCase())
      .join(" ");

    if (!token.includes("goal")) {
      return false;
    }

    return !/(disallowed|missed|saved|var|cancelled|canceled|no goal)/i.test(token);
  }

  private resolveTimelineGoalSide(row: Record<string, unknown>, homeTeamName: string, awayTeamName: string) {
    const homeAlias = this.normalizeAlias(homeTeamName);
    const awayAlias = this.normalizeAlias(awayTeamName);
    const teamToken = this.normalizeAlias(
      [
        row.strTeam,
        row.strPlayerTeam,
        row.strTimelineTeam,
        row.team,
        row.teamName
      ]
        .map((item) => String(item ?? ""))
        .filter((item) => item.trim().length > 0)
        .join(" ")
    );

    if (teamToken.length === 0) {
      return null;
    }

    let side: "home" | "away" | null = null;
    if (homeAlias.length > 0 && (teamToken === homeAlias || teamToken.includes(homeAlias) || homeAlias.includes(teamToken))) {
      side = "home";
    } else if (awayAlias.length > 0 && (teamToken === awayAlias || teamToken.includes(awayAlias) || awayAlias.includes(teamToken))) {
      side = "away";
    }

    if (!side) {
      return null;
    }

    const detailToken = `${String(row.strTimeline ?? "")} ${String(row.strTimelineDetail ?? "")}`.toLowerCase();
    if (detailToken.includes("own goal")) {
      return side === "home" ? "away" : "home";
    }

    return side;
  }

  private deriveTheSportsDbHalfTimeFromTimeline(
    timeline: Array<Record<string, unknown>>,
    homeTeamName: string,
    awayTeamName: string
  ): TheSportsDbHalfTimeRead {
    let home = 0;
    let away = 0;
    let reliableGoalEvents = 0;

    for (const row of timeline) {
      if (!this.isGoalTimelineEvent(row)) {
        continue;
      }

      const minute =
        this.parseTimelineGoalMinute(row.intTime) ??
        this.parseTimelineGoalMinute(row.strTime) ??
        this.parseTimelineGoalMinute(row.strMinute) ??
        this.parseTimelineGoalMinute(row.strTimelineDetail) ??
        this.parseTimelineGoalMinute(row.strTimeline);
      const side = this.resolveTimelineGoalSide(row, homeTeamName, awayTeamName);
      if (!minute || !side) {
        continue;
      }

      reliableGoalEvents += 1;
      if (!this.timelineMinuteIsFirstHalf(minute)) {
        continue;
      }

      if (side === "home") {
        home += 1;
      } else {
        away += 1;
      }
    }

    if (reliableGoalEvents <= 0) {
      return { home: null, away: null, source: null };
    }

    return { home, away, source: "timeline_derived" };
  }

  private readHalfTimeScore(row: Record<string, unknown>, side: "home" | "away") {
    const keyCandidates =
      side === "home"
        ? [
            "home_ht_score",
            "home_score_ht",
            "ht_home_score",
            "half_time_home_score",
            "score_ht_home",
            "home_half_score",
            "intHomeScoreHalfTime",
            "intHomeScoreHT",
            "intHomeScore1stHalf",
            "home_ht",
            "homeHalfTimeScore"
          ]
        : [
            "away_ht_score",
            "away_score_ht",
            "ht_away_score",
            "half_time_away_score",
            "score_ht_away",
            "away_half_score",
            "intAwayScoreHalfTime",
            "intAwayScoreHT",
            "intAwayScore1stHalf",
            "away_ht",
            "awayHalfTimeScore"
          ];

    for (const key of keyCandidates) {
      const value = this.toNullableScore(row[key]);
      if (value !== null) {
        return value;
      }
    }

    return null;
  }

  private readQuarterScoreFromSideScores(sideScores: Record<string, unknown>, quarter: 1 | 2 | 3 | 4) {
    const keyCandidates = [
      `q${quarter}`,
      `q_${quarter}`,
      `quarter_${quarter}`,
      `quarter${quarter}`,
      `period_${quarter}`,
      `period${quarter}`,
      `${quarter}`
    ];

    for (const key of keyCandidates) {
      const value = this.toNullableScore(sideScores[key]);
      if (value !== null) {
        return value;
      }
    }

    const arrayCandidates = [
      sideScores.linescore,
      sideScores.lineScore,
      sideScores.periods,
      sideScores.quarters,
      sideScores.periodScores
    ];

    for (const candidate of arrayCandidates) {
      if (!Array.isArray(candidate)) {
        continue;
      }
      const row = candidate[quarter - 1];
      if (row === undefined || row === null) {
        continue;
      }
      const direct = this.toNullableScore(row);
      if (direct !== null) {
        return direct;
      }
      const rowRecord = this.toRecord(row);
      if (!rowRecord) {
        continue;
      }
      const nested = this.toNullableScore(rowRecord.points ?? rowRecord.score ?? rowRecord.value);
      if (nested !== null) {
        return nested;
      }
    }

    return null;
  }

  private buildHalfTimeFromQuarters(
    q1HomeScore: number | null,
    q1AwayScore: number | null,
    q2HomeScore: number | null,
    q2AwayScore: number | null
  ) {
    if (
      q1HomeScore === null ||
      q1AwayScore === null ||
      q2HomeScore === null ||
      q2AwayScore === null
    ) {
      return { halfTimeHomeScore: null as number | null, halfTimeAwayScore: null as number | null };
    }

    return {
      halfTimeHomeScore: q1HomeScore + q2HomeScore,
      halfTimeAwayScore: q1AwayScore + q2AwayScore
    };
  }

  async rewindFootballResultsCheckpoints(daysBack: number) {
    const safeDaysBack = Math.max(1, Math.min(365, Math.trunc(daysBack)));
    const defaultCursor = this.todayDateString(-safeDaysBack);
    const fromDate = new Date(`${defaultCursor}T00:00:00.000Z`);
    const oldestMissingHalfTime = await this.prisma.match.findFirst({
      where: {
        sport: { code: "football" },
        status: MatchStatus.finished,
        matchDateTimeUTC: { gte: fromDate },
        OR: [{ halfTimeHomeScore: null }, { halfTimeAwayScore: null }]
      },
      orderBy: { matchDateTimeUTC: "asc" },
      select: { matchDateTimeUTC: true }
    });

    const missingHalfTimeCount = await this.prisma.match.count({
      where: {
        sport: { code: "football" },
        status: MatchStatus.finished,
        matchDateTimeUTC: { gte: fromDate },
        OR: [{ halfTimeHomeScore: null }, { halfTimeAwayScore: null }]
      }
    });

    const oldestMissingCursor =
      oldestMissingHalfTime !== null
        ? new Date(oldestMissingHalfTime.matchDateTimeUTC.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
        : null;
    const cursor = oldestMissingCursor && oldestMissingCursor < defaultCursor ? oldestMissingCursor : defaultCursor;
    const activeProviders = await this.providersService.listActiveApiProviders();
    const providerKeys = activeProviders.map((provider) => provider.key);

    for (const providerKey of providerKeys) {
      await this.setCheckpoint(providerKey, "football_matches_results", cursor);
    }

    return {
      cursor,
      daysBack: safeDaysBack,
      providers: providerKeys,
      missingHalfTimeCount,
      oldestMissingHalfTimeAt: oldestMissingHalfTime?.matchDateTimeUTC ?? null
    };
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
    const value = status.trim().toUpperCase();
    if (["MATCH FINISHED", "FINISHED", "FT", "AET", "PEN"].some((item) => value.includes(item))) {
      return MatchStatus.finished;
    }
    if (["IN_PLAY", "LIVE", "PAUSED", "1H", "2H", "HT", "HALF TIME", "HALFTIME"].some((item) => value.includes(item))) {
      return MatchStatus.live;
    }
    if (value === "NS" || value.includes("NOT STARTED")) {
      return MatchStatus.scheduled;
    }
    if (value.includes("POSTPONED")) {
      return MatchStatus.postponed;
    }
    if (value.includes("CANCELLED") || value.includes("CANCELED")) {
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

  private parseTheSportsDbEventDate(event: Record<string, unknown>) {
    const timestamp = typeof event.strTimestamp === "string" ? event.strTimestamp.trim() : "";
    if (timestamp.length > 0) {
      const parsed = new Date(timestamp);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed;
      }
    }
    return this.parseEventDate(event.dateEvent, event.strTime);
  }

  private theSportsDbFootballStatus(event: Record<string, unknown>) {
    const status = String(event.strStatus ?? "").trim();
    const progress = String(event.strProgress ?? "").trim();
    return this.footballStatus([status, progress].filter((item) => item.length > 0).join(" "));
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

  private hashPayload(payload: unknown) {
    return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
  }

  private toDateOrNull(value: unknown) {
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return value;
    }
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      if (Number.isFinite(parsed.getTime())) {
        return parsed;
      }
    }
    return null;
  }

  private providerSourcePriority(providerKey: string) {
    const normalized = providerKey.trim().toLowerCase();
    if (normalized === "football_data") {
      return 100;
    }
    if (normalized === "api_football") {
      return 95;
    }
    if (normalized === "the_sports_db") {
      return 88;
    }
    if (normalized === "sportapi_ai") {
      return 86;
    }
    if (normalized === "api_basketball" || normalized === "api_nba") {
      return 84;
    }
    if (normalized === "ball_dont_lie") {
      return 80;
    }
    return 75;
  }

  private async writeCanonicalMatchRevision(
    matchId: string,
    sourcePriority: number,
    mergedPayload: Record<string, unknown>
  ) {
    const payloadHash = this.hashPayload(mergedPayload);
    const latest = await this.prisma.canonicalMatchRevision.findFirst({
      where: { matchId },
      orderBy: { revisionNo: "desc" },
      select: { id: true, revisionNo: true, payloadHash: true }
    });

    if (latest?.payloadHash === payloadHash) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      if (latest) {
        await tx.canonicalMatchRevision.update({
          where: { id: latest.id },
          data: { validTo: new Date() }
        });
      }

      await tx.canonicalMatchRevision.create({
        data: {
          matchId,
          revisionNo: (latest?.revisionNo ?? 0) + 1,
          sourcePriority,
          validFrom: new Date(),
          validTo: null,
          payloadHash,
          mergedJson: mergedPayload as Prisma.InputJsonValue
        }
      });
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

    const sourceUpdatedAt =
      this.toDateOrNull(payload.updatedAt) ??
      this.toDateOrNull(payload.lastUpdatedAt) ??
      this.toDateOrNull(payload.sourceUpdatedAt);

    try {
      await this.prisma.rawProviderPayload.create({
        data: {
          provider: providerKey,
          entityType,
          providerEntityId: runId,
          sourceUpdatedAt,
          pulledAt: new Date(),
          payloadHash: this.hashPayload(payload),
          payloadJson: payload as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      this.logger.warn(
        `raw_provider_payloads write skipped for ${providerKey}/${entityType}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }

  private async upsertMatchFromExternal(input: MatchSeedInput): Promise<MatchUpsertResult> {
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
        halfTimeHomeScore: true,
        halfTimeAwayScore: true,
        homeElo: true,
        awayElo: true,
        form5Home: true,
        form5Away: true,
        dataSource: true
      }
    });

    const existingMatchForMerge = existingMatch
      ? {
          ...existingMatch,
          q1HomeScore: null as number | null,
          q1AwayScore: null as number | null,
          q2HomeScore: null as number | null,
          q2AwayScore: null as number | null,
          q3HomeScore: null as number | null,
          q3AwayScore: null as number | null,
          q4HomeScore: null as number | null,
          q4AwayScore: null as number | null
        }
      : null;

    const merged = this.mergeMatchState(existingMatchForMerge, input, normalizedStatus);

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
        halfTimeHomeScore: merged.halfTimeHomeScore,
        halfTimeAwayScore: merged.halfTimeAwayScore,
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
        halfTimeHomeScore: merged.halfTimeHomeScore,
        halfTimeAwayScore: merged.halfTimeAwayScore,
        homeElo: merged.homeElo,
        awayElo: merged.awayElo,
        form5Home: merged.form5Home,
        form5Away: merged.form5Away,
        dataSource: input.dataSource,
        importedAt: now,
        updatedByProcess: "provider_sync",
        mappingConfidence: 0.95,
        dataQualityScore: 0.9
      },
      select: {
        id: true
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

    try {
      await this.writeCanonicalMatchRevision(match.id, this.providerSourcePriority(input.providerKey), {
        providerKey: input.providerKey,
        providerMatchKey: input.providerMatchKey,
        sportCode: input.sportCode,
        leagueId: league.id,
        seasonId: season.id,
        homeTeamId: homeTeam.id,
        awayTeamId: awayTeam.id,
        matchDateTimeUTC: input.kickoffAt.toISOString(),
        status: merged.status,
        score: {
          home: merged.homeScore,
          away: merged.awayScore,
          halfTimeHome: merged.halfTimeHomeScore,
          halfTimeAway: merged.halfTimeAwayScore
        },
        ratings: {
          homeElo: merged.homeElo,
          awayElo: merged.awayElo,
          form5Home: merged.form5Home,
          form5Away: merged.form5Away
        },
        source: {
          dataSource: input.dataSource,
          importedAt: now.toISOString()
        }
      });
    } catch (error) {
      this.logger.warn(
        `canonical_match_revisions write skipped for match ${match.id}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }

    return {
      id: match.id,
      kickoffAt: input.kickoffAt,
      status: merged.status,
      homeScore: merged.homeScore,
      awayScore: merged.awayScore,
      halfTimeHomeScore: merged.halfTimeHomeScore,
      halfTimeAwayScore: merged.halfTimeAwayScore
    };
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

  private footballCompetitionPollCheckpointKey(mode: FootballSchedulerMode, competitionCode: string) {
    return `football_poll:${mode}:${competitionCode.trim().toUpperCase()}`;
  }

  private parseCursorDate(value: string | null | undefined) {
    if (!value) {
      return null;
    }
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) {
      return null;
    }
    return parsed;
  }

  private resolveCompetitionCodeFromLeague(
    league: { code: string | null; country: string | null },
    allowedCompetitionCodes: Set<string>
  ) {
    const leagueCode = String(league.code ?? "")
      .trim()
      .toUpperCase();
    if (leagueCode.length > 0 && allowedCompetitionCodes.has(leagueCode)) {
      return leagueCode;
    }

    const leagueCountry = String(league.country ?? "")
      .trim()
      .toUpperCase();
    if (leagueCountry.length > 0 && allowedCompetitionCodes.has(leagueCountry)) {
      return leagueCountry;
    }

    return null;
  }

  private async loadFootballCompetitionSignals(competitionCodes: string[], now: Date) {
    const allowedCodes = new Set(competitionCodes);
    const signals: Record<string, FootballCompetitionSignals> = Object.fromEntries(
      competitionCodes.map((code) => [
        code,
        {
          hasLive: false,
          hasKickoffInNext6Hours: false,
          hasKickoffIn6To24Hours: false,
          hasRecentFinishedAwaitingReconciliation: false
        }
      ])
    );

    const inSixHours = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const inTwentyFourHours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const twelveHoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000);

    const rows = await this.prisma.match.findMany({
      where: {
        sport: { code: "football" },
        league: {
          OR: [{ code: { in: competitionCodes } }, { country: { in: competitionCodes } }]
        },
        OR: [
          { status: MatchStatus.live },
          {
            status: MatchStatus.scheduled,
            matchDateTimeUTC: { gte: now, lte: inTwentyFourHours }
          },
          {
            status: MatchStatus.finished,
            matchDateTimeUTC: { gte: twelveHoursAgo, lte: now }
          }
        ]
      },
      select: {
        status: true,
        matchDateTimeUTC: true,
        league: {
          select: {
            code: true,
            country: true
          }
        }
      }
    });

    for (const row of rows) {
      const competitionCode = this.resolveCompetitionCodeFromLeague(
        { code: row.league.code, country: row.league.country },
        allowedCodes
      );
      if (!competitionCode) {
        continue;
      }
      const signal = signals[competitionCode];
      if (!signal) {
        continue;
      }

      if (row.status === MatchStatus.live) {
        signal.hasLive = true;
        continue;
      }

      if (row.status === MatchStatus.scheduled) {
        if (row.matchDateTimeUTC <= inSixHours) {
          signal.hasKickoffInNext6Hours = true;
        } else {
          signal.hasKickoffIn6To24Hours = true;
        }
        continue;
      }

      if (row.status === MatchStatus.finished) {
        signal.hasRecentFinishedAwaitingReconciliation = true;
      }
    }

    return signals;
  }

  private async loadFootballCompetitionLastPolledAt(
    providerKey: string,
    mode: FootballSchedulerMode,
    competitionCodes: string[]
  ) {
    const entityTypes = competitionCodes.map((code) => this.footballCompetitionPollCheckpointKey(mode, code));
    const checkpoints = await this.prisma.ingestionCheckpoint.findMany({
      where: {
        providerKey,
        entityType: { in: entityTypes }
      },
      select: {
        entityType: true,
        cursor: true
      }
    });

    const byEntityType = new Map(checkpoints.map((item) => [item.entityType, item.cursor] as const));
    const map: Record<string, Date | null> = {};
    for (const code of competitionCodes) {
      const entityType = this.footballCompetitionPollCheckpointKey(mode, code);
      map[code] = this.parseCursorDate(byEntityType.get(entityType));
    }
    return map;
  }

  private async setFootballCompetitionLastPolledAt(
    providerKey: string,
    mode: FootballSchedulerMode,
    competitionCode: string,
    at: Date
  ) {
    await this.setCheckpoint(
      providerKey,
      this.footballCompetitionPollCheckpointKey(mode, competitionCode),
      at.toISOString()
    );
  }

  private footballData429CooldownKey(providerKey: string) {
    return `provider:${providerKey}:429_recent`;
  }

  private async hadRecentFootballData429(providerKey: string) {
    const value = await this.cache.get<number>(this.footballData429CooldownKey(providerKey));
    return typeof value === "number" && value > 0;
  }

  private async markRecentFootballData429(providerKey: string) {
    await this.cache.set(this.footballData429CooldownKey(providerKey), Date.now(), 5 * 60);
  }

  private buildPredictionPhaseTriggers(match: MatchUpsertResult, now: Date): PredictionPhaseTriggerCandidate[] {
    const triggers: PredictionPhaseTriggerCandidate[] = [];
    const hasHalfTimeScore = this.hasHalfTimePair(match.halfTimeHomeScore, match.halfTimeAwayScore);
    const hasFullTimeScore = this.hasScorePair(match.homeScore, match.awayScore);

    if (match.status === MatchStatus.scheduled) {
      const diffMs = match.kickoffAt.getTime() - now.getTime();
      const windows = [
        { hours: 24, horizon: "PRE24" },
        { hours: 6, horizon: "PRE6" },
        { hours: 1, horizon: "PRE1" }
      ] as const;

      for (const window of windows) {
        if (diffMs <= window.hours * 60 * 60 * 1000 && diffMs > 0) {
          triggers.push({
            phase: "prematch",
            dedupKey: `match:${match.id}:prematch:${window.hours}h`,
            matchId: match.id,
            horizon: window.horizon,
            metadata: {
              kickoffAt: match.kickoffAt.toISOString(),
              windowHours: window.hours
            }
          });
        }
      }
    }

    if (match.status === MatchStatus.live && hasHalfTimeScore && !hasFullTimeScore) {
      triggers.push({
        phase: "halftime",
        dedupKey: `match:${match.id}:ht:${match.halfTimeHomeScore}-${match.halfTimeAwayScore}`,
        matchId: match.id,
        horizon: "HT",
        metadata: {
          halfTimeHomeScore: match.halfTimeHomeScore,
          halfTimeAwayScore: match.halfTimeAwayScore
        }
      });
    }

    if (match.status === MatchStatus.finished && hasFullTimeScore) {
      triggers.push({
        phase: "fulltime",
        dedupKey: `match:${match.id}:ft:${match.homeScore}-${match.awayScore}`,
        matchId: match.id,
        horizon: "POST_MATCH",
        metadata: {
          homeScore: match.homeScore,
          awayScore: match.awayScore
        }
      });
    }

    return triggers;
  }

  private async registerPredictionPhaseTrigger(candidate: PredictionPhaseTriggerCandidate, runId: string) {
    const checkpointKey = {
      providerKey_entityType: {
        providerKey: "prediction_phase_trigger",
        entityType: candidate.dedupKey
      }
    } as const;

    const existing = await this.prisma.ingestionCheckpoint.findUnique({
      where: checkpointKey,
      select: { providerKey: true }
    });
    if (existing) {
      return false;
    }

    try {
      await this.prisma.ingestionCheckpoint.create({
        data: {
          providerKey: "prediction_phase_trigger",
          entityType: candidate.dedupKey,
          cursor: new Date().toISOString(),
          lastSyncedAt: new Date()
        }
      });
      await this.createExternalPayload("internal_prediction_engine", runId, "prediction_phase_trigger", {
        ...candidate,
        acceptedAt: new Date().toISOString()
      });
      return true;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        return false;
      }
      throw error;
    }
  }

  private async processPredictionPhaseTriggers(
    runId: string,
    phaseCandidates: PredictionPhaseTriggerCandidate[]
  ) {
    if (phaseCandidates.length === 0) {
      return {
        candidates: 0,
        accepted: 0,
        deduped: 0,
        executedByPhase: {
          prematch: 0,
          halftime: 0,
          fulltime: 0
        }
      };
    }

    const uniqueByDedup = new Map<string, PredictionPhaseTriggerCandidate>();
    for (const candidate of phaseCandidates) {
      if (!uniqueByDedup.has(candidate.dedupKey)) {
        uniqueByDedup.set(candidate.dedupKey, candidate);
      }
    }

    const acceptedByPhase: Record<PredictionPhase, Set<string>> = {
      prematch: new Set<string>(),
      halftime: new Set<string>(),
      fulltime: new Set<string>()
    };

    let accepted = 0;
    for (const candidate of uniqueByDedup.values()) {
      const isNew = await this.registerPredictionPhaseTrigger(candidate, runId);
      if (!isNew) {
        continue;
      }
      accepted += 1;
      acceptedByPhase[candidate.phase].add(candidate.matchId);
    }

    for (const phase of ["prematch", "halftime", "fulltime"] as const) {
      const scopedMatchIds = [...acceptedByPhase[phase]];
      if (scopedMatchIds.length === 0) {
        continue;
      }
      await this.generatePredictions(`${runId}:${phase}`, {
        matchIds: scopedMatchIds,
        reason: `phase_trigger_${phase}`
      });
    }

    return {
      candidates: phaseCandidates.length,
      accepted,
      deduped: uniqueByDedup.size - accepted,
      executedByPhase: {
        prematch: acceptedByPhase.prematch.size,
        halftime: acceptedByPhase.halftime.size,
        fulltime: acceptedByPhase.fulltime.size
      }
    };
  }

  private async syncFootballData(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    if (
      jobType !== "syncFixtures" &&
      jobType !== "syncFixturesHotPulse" &&
      jobType !== "syncResults" &&
      jobType !== "syncResultsReconcile" &&
      jobType !== "syncStandings"
    ) {
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

    const mode: FootballSchedulerMode =
      jobType === "syncFixturesHotPulse"
        ? "fixtures_hot_pulse"
        : jobType === "syncResults"
          ? "results"
          : jobType === "syncResultsReconcile"
            ? "results_reconcile"
            : jobType === "syncStandings"
              ? "standings"
              : "fixtures";

    if (jobType === "syncStandings") {
      return this.syncFootballDataStandings(provider, runId, settings, mode);
    }

    const now = new Date();
    const checkpointEntityType =
      mode === "results"
        ? "football_matches_results"
        : mode === "results_reconcile"
          ? "football_matches_results_reconcile"
          : mode === "fixtures_hot_pulse"
            ? "football_matches_hot_pulse"
            : "football_matches_fixtures";
    const checkpoint = await this.getCheckpoint(provider.key, checkpointEntityType);
    const dateTo =
      mode === "results" || mode === "results_reconcile"
        ? this.todayDateString(1)
        : mode === "fixtures_hot_pulse"
          ? this.todayDateString(1)
          : this.todayDateString(7);
    const defaultDateFrom =
      mode === "results" || mode === "results_reconcile"
        ? this.todayDateString(-30)
        : mode === "fixtures_hot_pulse"
          ? this.todayDateString(0)
          : this.todayDateString(-2);
    let dateFrom = defaultDateFrom;
    if (mode === "results" && checkpoint && checkpoint.length >= 10) {
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
      const plannedRequestsPerMinute = this.parseConfigInt(
        settings.plannedRequestsPerMinute,
        this.parseEnvInt("FOOTBALL_DATA_PLANNED_REQUESTS_PER_MINUTE", 8)
      );
      const reserveRequestsPerMinute = this.parseConfigInt(
        settings.reserveRequestsPerMinute,
        this.parseEnvInt("FOOTBALL_DATA_RESERVE_REQUESTS_PER_MINUTE", 2)
      );
      const minIntervalMs = this.parseConfigInt(
        settings.minIntervalMs,
        this.parseEnvInt("FOOTBALL_DATA_MIN_INTERVAL_MS", 7000)
      );
      const maxCallsPerRun = this.parseConfigInt(
        settings.maxCallsPerRun,
        this.parseEnvInt("FOOTBALL_DATA_MAX_CALLS_PER_RUN", 12)
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

      const hadRecent429 = await this.hadRecentFootballData429(provider.key);
      const baseBudget = deriveFootballRequestBudget({
        hardLimitPerMinute: minuteRateLimit,
        plannedTargetPerMinute: plannedRequestsPerMinute,
        reservePerMinute: Math.max(reserveRequestsPerMinute, minuteRateBuffer),
        hadRecent429
      });
      const competitionSignals = await this.loadFootballCompetitionSignals(orderedCompetitionCodes, now);
      const lastPolledAtByCode = await this.loadFootballCompetitionLastPolledAt(provider.key, mode, orderedCompetitionCodes);
      const selection = selectFootballCompetitionsForRun({
        mode,
        competitionCodes: orderedCompetitionCodes,
        signalsByCode: competitionSignals,
        lastPolledAtByCode,
        now,
        plannedCalls: baseBudget.plannedCalls,
        maxCallsCap: maxCallsPerRun,
        allowFullCycleWhenSafe: mode === "results_reconcile",
        forceIncludeAtLeastOne: mode !== "fixtures_hot_pulse"
      });
      const selectedCompetitionCodes = selection.selectedCompetitionCodes;
      const deferredCompetitionCodes = selection.deferredCompetitionCodes;
      const nextCursor = deferredCompetitionCodes.length > 0 ? orderedCompetitionCodes.indexOf(deferredCompetitionCodes[0]) : 0;

      let written = 0;
      let errors = 0;
      let recordsRead = 0;
      let totalWaitMs = 0;
      let totalRetryCount = 0;
      let totalRetryBackoffMs = 0;
      let requestsAttempted = 0;
      let requestsSucceeded = 0;
      let requestsRetried = 0;
      let request429Count = hadRecent429 ? 1 : 0;
      let skippedDueBudget = 0;
      let halftimeReadyMatches = 0;
      let fulltimeLagMinutesTotal = 0;
      let fulltimeLagSamples = 0;
      let dynamicRemainingHeader: number | undefined;
      const phaseCandidates: PredictionPhaseTriggerCandidate[] = [];
    const perCompetition: Array<{
      competitionCode: string;
      recordsRead: number;
      recordsWritten: number;
      errors: number;
        ok: boolean;
        waitMs: number;
        retries: number;
        bucket: FootballCompetitionBucket;
        due: boolean;
        cadenceMinutes: number;
      message?: string;
    }> = [];

      for (const competitionCode of selectedCompetitionCodes) {
        const adaptiveBudget = deriveFootballRequestBudget({
          hardLimitPerMinute: minuteRateLimit,
          plannedTargetPerMinute: plannedRequestsPerMinute,
          reservePerMinute: Math.max(reserveRequestsPerMinute, minuteRateBuffer),
          remainingHeader: dynamicRemainingHeader,
          hadRecent429: request429Count > 0
        });
        if (adaptiveBudget.plannedCalls <= 0) {
          skippedDueBudget += 1;
          break;
        }

        requestsAttempted += 1;
        const throttle = await this.footballDataThrottle(
          provider.key,
          minuteRateLimit,
          Math.max(minuteRateBuffer, Math.max(0, minuteRateLimit - adaptiveBudget.plannedCalls)),
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
          requestsSucceeded += 1;
          requestsRetried += fetched.retries;
          if (fetched.had429) {
            request429Count += 1;
            await this.markRecentFootballData429(provider.key);
          }
          totalRetryCount += fetched.retries;
          totalRetryBackoffMs += fetched.backoffMsTotal;
          const response = fetched.response;
          const responseMeta = (response as { __meta?: FootballDataRateLimitMeta }).__meta;
          if (typeof responseMeta?.remaining === "number" && Number.isFinite(responseMeta.remaining)) {
            dynamicRemainingHeader = Math.max(0, Math.floor(responseMeta.remaining));
          }
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
          const halfTimeObj = (scoreObj.halfTime as Record<string, unknown> | undefined) ?? {};
          const halfTimeFromNested = this.readHalfTimeScorePair(halfTimeObj);
          const halfTimeFromScore = this.readHalfTimeScorePair(scoreObj);
          const halfTimeHomeScore = halfTimeFromNested.home ?? halfTimeFromScore.home;
          const halfTimeAwayScore = halfTimeFromNested.away ?? halfTimeFromScore.away;

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
          const upserted = await this.upsertMatchFromExternal({
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
            halfTimeHomeScore,
            halfTimeAwayScore,
            refereeName,
            dataSource: provider.key
          });
          written += 1;
          competitionWritten += 1;
          const triggers = this.buildPredictionPhaseTriggers(upserted, now);
          phaseCandidates.push(...triggers);
          if (upserted.status === MatchStatus.live && this.hasHalfTimePair(upserted.halfTimeHomeScore, upserted.halfTimeAwayScore) && !this.hasScorePair(upserted.homeScore, upserted.awayScore)) {
            halftimeReadyMatches += 1;
          }
          if (upserted.status === MatchStatus.finished && this.hasScorePair(upserted.homeScore, upserted.awayScore)) {
            fulltimeLagMinutesTotal += Math.max(0, Math.round((now.getTime() - upserted.kickoffAt.getTime()) / 60000));
            fulltimeLagSamples += 1;
          }
        }
        await this.setFootballCompetitionLastPolledAt(provider.key, mode, competitionCode, new Date());

        perCompetition.push({
          competitionCode,
          recordsRead: matches.length,
          recordsWritten: competitionWritten,
          errors: competitionErrors,
            ok: true,
            waitMs: throttle.waitedMs,
            retries: fetched.retries,
            bucket: selection.bucketByCompetitionCode[competitionCode],
            due: selection.dueByCompetitionCode[competitionCode],
            cadenceMinutes: selection.cadenceByCompetitionCodeMinutes[competitionCode]
        });
        if (typeof dynamicRemainingHeader === "number" && dynamicRemainingHeader <= adaptiveBudget.reserveCalls) {
          skippedDueBudget += Math.max(0, selectedCompetitionCodes.length - perCompetition.length);
          break;
        }
      } catch (error) {
        const durationMs = Date.now() - startedAt;
          const statusCode = error instanceof FootballDataHttpError ? error.status : 500;
          if (statusCode === 429) {
            request429Count += 1;
            await this.markRecentFootballData429(provider.key);
          }
          await this.logApiCall(
            `provider/${provider.key}/competitions/${competitionCode}/matches`,
            statusCode,
            durationMs,
            runId
          );
        const message = error instanceof Error ? error.message : "football_data fetch error";
        errors += 1;
        perCompetition.push({
          competitionCode,
          recordsRead: 0,
          recordsWritten: 0,
          errors: 1,
          ok: false,
            waitMs: throttle.waitedMs,
            retries: 0,
            bucket: selection.bucketByCompetitionCode[competitionCode],
            due: selection.dueByCompetitionCode[competitionCode],
            cadenceMinutes: selection.cadenceByCompetitionCodeMinutes[competitionCode],
          message
        });
      }
    }

      const phaseTriggerSummary = await this.processPredictionPhaseTriggers(runId, phaseCandidates);

      await this.setCheckpoint(provider.key, checkpointEntityType, dateTo);
      if (mode === "fixtures") {
        await this.setCheckpoint(provider.key, "football_matches", dateTo);
      }
      await this.setCheckpoint(
        provider.key,
        mode === "results" || mode === "results_reconcile"
          ? "football_matches_results_competition_cursor"
          : "football_matches_competition_cursor",
        String(nextCursor >= 0 ? nextCursor : 0)
      );
      const staleCompetitionLagMinutes = orderedCompetitionCodes.length
        ? Math.max(
            ...orderedCompetitionCodes.map((code) => {
              const lastPolledAt = lastPolledAtByCode[code];
              if (!lastPolledAt) {
                return 99999;
              }
              return Math.max(0, Math.round((now.getTime() - lastPolledAt.getTime()) / 60000));
            })
          )
        : 0;
      const halftimeCaptureRate =
        halftimeReadyMatches > 0
          ? Number((phaseTriggerSummary.executedByPhase.halftime / halftimeReadyMatches).toFixed(4))
          : null;
      const fulltimeReconciliationLagMinutes =
        fulltimeLagSamples > 0 ? Number((fulltimeLagMinutesTotal / fulltimeLagSamples).toFixed(2)) : null;
      await this.createExternalPayload(provider.key, runId, "football_data_matches", {
        mode,
        competitionCodes,
        orderedCompetitionCodes,
        priorityCompetitionCodes: priorityCodes,
        selectedCompetitionCodes,
        deferredCompetitionCodes,
        bucketByCompetitionCode: selection.bucketByCompetitionCode,
        bucketSizes: selection.bucketSizes,
        selectedCounts: selection.selectedCounts,
        dueByCompetitionCode: selection.dueByCompetitionCode,
        cadenceByCompetitionCodeMinutes: selection.cadenceByCompetitionCodeMinutes,
        perCompetition,
        dateFrom,
        dateTo,
        recordsRead,
        recordsWritten: written,
        errors,
        checkpointEntityType,
        checkpointCursorAfter: nextCursor,
        rateLimit: {
          minuteRateLimit,
          minuteRateBuffer,
          plannedRequestsPerMinute,
          reserveRequestsPerMinute,
          minIntervalMs,
          maxCallsPerRun,
          retryMax
        },
        requestBudget: baseBudget,
        requestsAttempted,
        requestsSucceeded,
        requestsRetried,
        request429Count,
        skippedDueBudget,
        adaptiveRemainingHeader: dynamicRemainingHeader ?? null,
        phaseTriggers: phaseTriggerSummary,
        halftimeCaptureRate,
        fulltimeReconciliationLagMinutes,
        staleCompetitionLagMinutes,
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
        mode,
        competitionCodes,
        orderedCompetitionCodes,
        priorityCompetitionCodes: priorityCodes,
        selectedCompetitionCodes,
        deferredCompetitionCodes,
        bucketByCompetitionCode: selection.bucketByCompetitionCode,
        bucketSizes: selection.bucketSizes,
        selectedCounts: selection.selectedCounts,
        dueByCompetitionCode: selection.dueByCompetitionCode,
        cadenceByCompetitionCodeMinutes: selection.cadenceByCompetitionCodeMinutes,
        perCompetition,
        dateFrom,
        dateTo,
        checkpointEntityType,
        checkpointCursorAfter: nextCursor,
        rateLimit: {
          minuteRateLimit,
          minuteRateBuffer,
          plannedRequestsPerMinute,
          reserveRequestsPerMinute,
          minIntervalMs,
          maxCallsPerRun,
          retryMax
        },
        requestBudget: baseBudget,
        requestsAttempted,
        requestsSucceeded,
        requestsRetried,
        request429Count,
        skippedDueBudget,
        adaptiveRemainingHeader: dynamicRemainingHeader ?? null,
        phaseTriggers: phaseTriggerSummary,
        halftimeCaptureRate,
        fulltimeReconciliationLagMinutes,
        staleCompetitionLagMinutes,
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
      plannedRequestsPerMinute?: number;
      reserveRequestsPerMinute?: number;
      minIntervalMs?: number;
      maxCallsPerRun?: number;
      retryMax?: number;
    },
    mode: FootballSchedulerMode = "standings"
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
      const now = new Date();
      const minuteRateLimit = this.parseConfigInt(
        settings.minuteRateLimit,
        this.parseEnvInt("FOOTBALL_DATA_RATE_LIMIT_PER_MINUTE", 10)
      );
      const minuteRateBuffer = this.parseConfigInt(
        settings.minuteRateBuffer,
        this.parseEnvInt("FOOTBALL_DATA_RATE_LIMIT_BUFFER", 1)
      );
      const plannedRequestsPerMinute = this.parseConfigInt(
        settings.plannedRequestsPerMinute,
        this.parseEnvInt("FOOTBALL_DATA_PLANNED_REQUESTS_PER_MINUTE", 8)
      );
      const reserveRequestsPerMinute = this.parseConfigInt(
        settings.reserveRequestsPerMinute,
        this.parseEnvInt("FOOTBALL_DATA_RESERVE_REQUESTS_PER_MINUTE", 2)
      );
      const minIntervalMs = this.parseConfigInt(
        settings.minIntervalMs,
        this.parseEnvInt("FOOTBALL_DATA_MIN_INTERVAL_MS", 7000)
      );
      const maxCallsPerRun = this.parseConfigInt(
        settings.maxCallsPerRun,
        this.parseEnvInt("FOOTBALL_DATA_MAX_CALLS_PER_RUN", 12)
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

      const hadRecent429 = await this.hadRecentFootballData429(provider.key);
      const baseBudget = deriveFootballRequestBudget({
        hardLimitPerMinute: minuteRateLimit,
        plannedTargetPerMinute: plannedRequestsPerMinute,
        reservePerMinute: Math.max(reserveRequestsPerMinute, minuteRateBuffer),
        hadRecent429
      });
      const competitionSignals = await this.loadFootballCompetitionSignals(orderedCompetitionCodes, now);
      const lastPolledAtByCode = await this.loadFootballCompetitionLastPolledAt(provider.key, mode, orderedCompetitionCodes);
      const selection = selectFootballCompetitionsForRun({
        mode,
        competitionCodes: orderedCompetitionCodes,
        signalsByCode: competitionSignals,
        lastPolledAtByCode,
        now,
        plannedCalls: baseBudget.plannedCalls,
        maxCallsCap: maxCallsPerRun,
        allowFullCycleWhenSafe: true,
        forceIncludeAtLeastOne: false
      });

      const selectedCompetitionCodes = selection.selectedCompetitionCodes;
      const deferredCompetitionCodes = selection.deferredCompetitionCodes;
      const nextCursor = deferredCompetitionCodes.length > 0 ? orderedCompetitionCodes.indexOf(deferredCompetitionCodes[0]) : 0;

      if (selectedCompetitionCodes.length === 0) {
        return {
          providerKey: provider.key,
          recordsRead: 0,
          recordsWritten: 0,
          errors: 0,
          details: {
            mode: "syncStandings",
            message: "Standings kadansina gore bu calismada due competition bulunamadi.",
            competitionCodes: orderedCompetitionCodes
          }
        };
      }

      const seasonFilter = settings.season?.trim();
      let recordsRead = 0;
      let recordsWritten = 0;
      let errors = 0;
      let totalWaitMs = 0;
      let totalRetryCount = 0;
      let totalRetryBackoffMs = 0;
      let requestsAttempted = 0;
      let requestsSucceeded = 0;
      let requestsRetried = 0;
      let request429Count = hadRecent429 ? 1 : 0;
      let skippedDueBudget = 0;
      let dynamicRemainingHeader: number | undefined;
      const perCompetition: Array<{
        competitionCode: string;
        recordsRead: number;
        recordsWritten: number;
        errors: number;
        ok: boolean;
        waitMs: number;
        retries: number;
        bucket: FootballCompetitionBucket;
        due: boolean;
        cadenceMinutes: number;
        seasonLabel?: string | null;
        message?: string;
      }> = [];

      for (const competitionCode of selectedCompetitionCodes) {
        const adaptiveBudget = deriveFootballRequestBudget({
          hardLimitPerMinute: minuteRateLimit,
          plannedTargetPerMinute: plannedRequestsPerMinute,
          reservePerMinute: Math.max(reserveRequestsPerMinute, minuteRateBuffer),
          remainingHeader: dynamicRemainingHeader,
          hadRecent429: request429Count > 0
        });
        if (adaptiveBudget.plannedCalls <= 0) {
          skippedDueBudget += 1;
          break;
        }
        requestsAttempted += 1;
        const throttle = await this.footballDataThrottle(
          provider.key,
          minuteRateLimit,
          Math.max(minuteRateBuffer, Math.max(0, minuteRateLimit - adaptiveBudget.plannedCalls)),
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
          requestsSucceeded += 1;
          requestsRetried += fetched.retries;
          if (fetched.had429) {
            request429Count += 1;
            await this.markRecentFootballData429(provider.key);
          }
          totalRetryCount += fetched.retries;
          totalRetryBackoffMs += fetched.backoffMsTotal;
          const response = fetched.response;
          const responseMeta = (response as { __meta?: FootballDataRateLimitMeta }).__meta;
          if (typeof responseMeta?.remaining === "number" && Number.isFinite(responseMeta.remaining)) {
            dynamicRemainingHeader = Math.max(0, Math.floor(responseMeta.remaining));
          }
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
          await this.setFootballCompetitionLastPolledAt(provider.key, mode, competitionCode, new Date());

          perCompetition.push({
            competitionCode,
            recordsRead: rows.length,
            recordsWritten: competitionWritten,
            errors: competitionErrors,
            ok: true,
            waitMs: throttle.waitedMs,
            retries: fetched.retries,
            bucket: selection.bucketByCompetitionCode[competitionCode],
            due: selection.dueByCompetitionCode[competitionCode],
            cadenceMinutes: selection.cadenceByCompetitionCodeMinutes[competitionCode],
            seasonLabel:
              seasonStartDateRaw.length > 0
                ? this.footballSeasonLabel(this.parseEventDate(seasonStartDateRaw) ?? new Date())
                : null
          });
          if (typeof dynamicRemainingHeader === "number" && dynamicRemainingHeader <= adaptiveBudget.reserveCalls) {
            skippedDueBudget += Math.max(0, selectedCompetitionCodes.length - perCompetition.length);
            break;
          }
        } catch (error) {
          const durationMs = Date.now() - startedAt;
          const statusCode = error instanceof FootballDataHttpError ? error.status : 500;
          if (statusCode === 429) {
            request429Count += 1;
            await this.markRecentFootballData429(provider.key);
          }
          await this.logApiCall(
            `provider/${provider.key}/competitions/${competitionCode}/standings`,
            statusCode,
            durationMs,
            runId
          );
          const message = error instanceof Error ? error.message : "football_data standings fetch error";
          errors += 1;
          perCompetition.push({
            competitionCode,
            recordsRead: 0,
            recordsWritten: 0,
            errors: 1,
            ok: false,
            waitMs: throttle.waitedMs,
            retries: 0,
            bucket: selection.bucketByCompetitionCode[competitionCode],
            due: selection.dueByCompetitionCode[competitionCode],
            cadenceMinutes: selection.cadenceByCompetitionCodeMinutes[competitionCode],
            message
          });
        }
      }

      const checkpointDate = this.todayDateString(0);
      await this.setCheckpoint(provider.key, "football_standings", checkpointDate);
      await this.setCheckpoint(provider.key, "football_standings_competition_cursor", String(nextCursor >= 0 ? nextCursor : 0));
      const staleCompetitionLagMinutes = orderedCompetitionCodes.length
        ? Math.max(
            ...orderedCompetitionCodes.map((code) => {
              const lastPolledAt = lastPolledAtByCode[code];
              if (!lastPolledAt) {
                return 99999;
              }
              return Math.max(0, Math.round((now.getTime() - lastPolledAt.getTime()) / 60000));
            })
          )
        : 0;

      await this.createExternalPayload(provider.key, runId, "football_data_standings", {
        mode,
        competitionCodes,
        orderedCompetitionCodes,
        priorityCompetitionCodes: priorityCodes,
        selectedCompetitionCodes,
        deferredCompetitionCodes,
        bucketByCompetitionCode: selection.bucketByCompetitionCode,
        bucketSizes: selection.bucketSizes,
        selectedCounts: selection.selectedCounts,
        dueByCompetitionCode: selection.dueByCompetitionCode,
        cadenceByCompetitionCodeMinutes: selection.cadenceByCompetitionCodeMinutes,
        perCompetition,
        seasonFilter: seasonFilter ?? null,
        recordsRead,
        recordsWritten,
        errors,
        checkpointDate,
        checkpointCursorAfter: nextCursor,
        rateLimit: {
          minuteRateLimit,
          minuteRateBuffer,
          plannedRequestsPerMinute,
          reserveRequestsPerMinute,
          minIntervalMs,
          maxCallsPerRun,
          retryMax
        },
        requestBudget: baseBudget,
        requestsAttempted,
        requestsSucceeded,
        requestsRetried,
        request429Count,
        skippedDueBudget,
        adaptiveRemainingHeader: dynamicRemainingHeader ?? null,
        staleCompetitionLagMinutes,
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
          bucketByCompetitionCode: selection.bucketByCompetitionCode,
          bucketSizes: selection.bucketSizes,
          selectedCounts: selection.selectedCounts,
          dueByCompetitionCode: selection.dueByCompetitionCode,
          cadenceByCompetitionCodeMinutes: selection.cadenceByCompetitionCodeMinutes,
          seasonFilter: seasonFilter ?? null,
          checkpointCursorAfter: nextCursor,
          perCompetition,
          requestBudget: baseBudget,
          requestsAttempted,
          requestsSucceeded,
          requestsRetried,
          request429Count,
          skippedDueBudget,
          adaptiveRemainingHeader: dynamicRemainingHeader ?? null,
          staleCompetitionLagMinutes
        }
      };
    } finally {
      await this.cache.releaseLock(lockKey, lockOwner);
    }
  }

  private uniqueTheSportsDbEvents(events: Array<Record<string, unknown>>) {
    return Array.from(
      new Map(
        events.map((event) => {
          const fallback = `${String(event.strHomeTeam ?? "").trim()}_${String(event.strAwayTeam ?? "").trim()}_${String(event.dateEvent ?? "").trim()}_${String(event.strTime ?? "").trim()}`;
          return [String(event.idEvent ?? fallback), event];
        })
      ).values()
    );
  }

  private theSportsDbProviderMatchKey(
    event: Record<string, unknown>,
    sportCode: "football" | "basketball",
    homeTeamName: string,
    awayTeamName: string,
    kickoffAt: Date
  ) {
    const idEvent = String(event.idEvent ?? "").trim();
    if (idEvent.length > 0) {
      return idEvent;
    }
    return `${sportCode}-${this.normalizeKey(homeTeamName)}-${this.normalizeKey(awayTeamName)}-${kickoffAt.toISOString()}`;
  }

  private async upsertTheSportsDbEvent(params: {
    provider: ProviderRecord;
    event: Record<string, unknown>;
    fallbackSportCode: "football" | "basketball";
    dateFrom?: Date;
    dateTo?: Date;
    timeline?: Array<Record<string, unknown>>;
  }) {
    const event = params.event;
    const sportRaw = String(event.strSport ?? "").toLowerCase();
    const resolvedSportCode =
      sportRaw.includes("basket")
        ? "basketball"
        : sportRaw.includes("soccer") || sportRaw.includes("football")
          ? "football"
          : params.fallbackSportCode;
    const resolvedSportName = resolvedSportCode === "basketball" ? "Basketball" : "Football";
    const kickoffAt = this.parseTheSportsDbEventDate(event);
    const homeTeamName = String(event.strHomeTeam ?? "").trim();
    const awayTeamName = String(event.strAwayTeam ?? "").trim();

    if (!kickoffAt || homeTeamName.length === 0 || awayTeamName.length === 0) {
      return {
        skipped: true,
        halfTimeSource: null as TheSportsDbHalfTimeSource,
        matchId: null as string | null
      };
    }
    if (params.dateFrom && kickoffAt < params.dateFrom) {
      return {
        skipped: true,
        halfTimeSource: null as TheSportsDbHalfTimeSource,
        matchId: null as string | null
      };
    }
    if (params.dateTo && kickoffAt > params.dateTo) {
      return {
        skipped: true,
        halfTimeSource: null as TheSportsDbHalfTimeSource,
        matchId: null as string | null
      };
    }

    const directHalfTime = this.readTheSportsDbDirectHalfTimeScore(event);
    const timelineHalfTime =
      this.hasHalfTimePair(directHalfTime.home, directHalfTime.away) || !params.timeline
        ? { home: null, away: null, source: null as TheSportsDbHalfTimeSource }
        : this.deriveTheSportsDbHalfTimeFromTimeline(params.timeline, homeTeamName, awayTeamName);
    const halfTime = this.hasHalfTimePair(directHalfTime.home, directHalfTime.away) ? directHalfTime : timelineHalfTime;
    const providerMatchKey = this.theSportsDbProviderMatchKey(
      event,
      resolvedSportCode,
      homeTeamName,
      awayTeamName,
      kickoffAt
    );
    const status =
      resolvedSportCode === "football"
        ? this.theSportsDbFootballStatus(event)
        : this.basketballStatus(String(event.strStatus ?? event.strProgress ?? "Scheduled"));
    const refereeName = typeof event.strReferee === "string" && event.strReferee.trim().length > 0 ? String(event.strReferee) : null;

    const upserted = await this.upsertMatchFromExternal({
      providerId: params.provider.id,
      providerKey: params.provider.key,
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
      halfTimeHomeScore: halfTime.home,
      halfTimeAwayScore: halfTime.away,
      refereeName,
      dataSource: params.provider.key
    });

    if (halfTime.source) {
      try {
        await this.applyContextPatchToFeatureSnapshot(upserted.id, {
          theSportsDbHalfTimeSource: halfTime.source,
          theSportsDbHalfTimeUpdatedAt: new Date().toISOString()
        });
      } catch (error) {
        this.logger.warn(
          `TheSportsDB half-time metadata write skipped for ${providerMatchKey}: ${
            error instanceof Error ? error.message : "unknown"
          }`
        );
      }
    }

    return {
      skipped: false,
      halfTimeSource: halfTime.source,
      matchId: upserted.id
    };
  }

  private async syncTheSportsDb(
    provider: { id: string; key: string; baseUrl: string | null },
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    const settings = await this.providersService.getProviderRuntimeSettings(provider.key);
    const apiKey = settings.apiKey;
    const soccerLeagueIds = this.theSportsDbSoccerLeagueIds(settings);
    const basketballLeagueIds = this.theSportsDbBasketballLeagueIds(settings);
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
        soccerLeagueIds,
        basketballLeagueIds,
        dailyLimit
      });
    }

    if (jobType === "enrichTeamProfiles") {
      return this.enrichTheSportsDbTeamProfiles(provider, runId, {
        apiKey,
        baseUrl,
        soccerLeagueIds,
        basketballLeagueIds,
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
    const mode = isResultsBackfill ? "syncResults" : "syncFixtures";
    const soccerSeason = settings.soccerSeason || this.footballSeasonLabel(new Date());
    const backfillFromDate =
      this.parseIsoDateOnly(settings.soccerBackfillFrom) ?? new Date(Date.UTC(new Date().getUTCFullYear(), 0, 1));
    const backfillToDate = new Date();
    const plannedCalls =
      soccerLeagueIds.length * (isResultsBackfill ? 2 : 1) + (isResultsBackfill ? 0 : basketballLeagueIds.length);
    const quota = await this.quotaGate(provider.key, plannedCalls, dailyLimit);
    const remainingCalls = Number.isFinite(quota.remaining)
      ? Math.max(0, Math.floor(quota.remaining))
      : plannedCalls;

    if (remainingCalls <= 0) {
      await this.logApiCall(`provider/${provider.key}/${isResultsBackfill ? "sync-results" : "sync-fixtures"}`, 429, 0, runId);
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 1,
        details: {
          mode,
          message: "TheSportsDB günlük kota nedeniyle senkron atlandı.",
          plannedCalls,
          attemptedCalls: 0,
          successfulCalls: 0,
          skippedDueQuota: plannedCalls,
          quota: {
            used: quota.used,
            remaining: quota.remaining,
            limit: quota.limit
          }
        }
      };
    }

    let callBudget = remainingCalls;
    let attemptedCalls = 0;
    let successfulCalls = 0;
    let skippedDueQuota = 0;
    let recordsRead = 0;
    let recordsWritten = 0;
    let halfTimeScoresWritten = 0;
    let directHalfTimeScoresWritten = 0;
    let timelineHalfTimeScoresWritten = 0;
    let errors = 0;
    const writtenMatchIds: string[] = [];
    const perLeague: TheSportsDbLeagueRunSummary[] = [];
    const runErrors: string[] = [];

    const fetchWithQuota = async <T>(
      path: string,
      fetcher: () => Promise<T>,
      summary?: TheSportsDbLeagueRunSummary
    ): Promise<T | null> => {
      if (callBudget <= 0) {
        skippedDueQuota += 1;
        if (summary) {
          summary.skippedDueQuota += 1;
        }
        return null;
      }
      callBudget -= 1;
      attemptedCalls += 1;
      if (summary) {
        summary.attemptedCalls += 1;
      }
      const startedAt = Date.now();
      try {
        const response = await fetcher();
        successfulCalls += 1;
        if (summary) {
          summary.successfulCalls += 1;
        }
        await this.logApiCall(`provider/${provider.key}/${path}`, 200, Date.now() - startedAt, runId);
        return response;
      } catch (error) {
        errors += 1;
        const message = error instanceof Error ? error.message : "unknown";
        const statusCode = message.includes("429") ? 429 : 500;
        await this.logApiCall(`provider/${provider.key}/${path}`, statusCode, Date.now() - startedAt, runId);
        if (summary) {
          summary.errors.push(message);
        }
        runErrors.push(`${path}: ${message}`);
        if (statusCode === 429) {
          callBudget = 0;
        }
        return null;
      }
    };

    for (const leagueId of soccerLeagueIds) {
      const checkpointEntityType = isResultsBackfill
        ? `the_sports_db_results:${leagueId}:${soccerSeason}`
        : `the_sports_db_fixtures:${leagueId}`;
      const checkpointBefore = await this.getCheckpoint(provider.key, checkpointEntityType);
      const summary: TheSportsDbLeagueRunSummary = {
        leagueId,
        season: soccerSeason,
        mode,
        plannedCalls: isResultsBackfill ? 2 : 1,
        attemptedCalls: 0,
        successfulCalls: 0,
        skippedDueQuota: 0,
        eventsRead: 0,
        matchesWritten: 0,
        halfTimeScoresWritten: 0,
        directHalfTimeScoresWritten: 0,
        timelineHalfTimeScoresWritten: 0,
        roundsAttempted: 0,
        errors: [],
        checkpointBefore: checkpointBefore ?? null,
        checkpointAfter: null
      };

      const soccerEvents: Array<Record<string, unknown>> = [];
      if (isResultsBackfill) {
        const past = await fetchWithQuota(
          `eventspastleague/${leagueId}`,
          () => this.theSportsDbConnector.fetchPastSoccerEvents(apiKey, leagueId, baseUrl),
          summary
        );
        soccerEvents.push(...this.toRecordArray(past?.events));

        const season = await fetchWithQuota(
          `eventsseason/${leagueId}/${soccerSeason}`,
          () => this.theSportsDbConnector.fetchSoccerSeasonEvents(apiKey, leagueId, soccerSeason, baseUrl),
          summary
        );
        soccerEvents.push(...this.toRecordArray(season?.events));
      } else {
        const upcoming = await fetchWithQuota(
          `eventsnextleague/${leagueId}`,
          () => this.theSportsDbConnector.fetchUpcomingSoccerEvents(apiKey, leagueId, baseUrl),
          summary
        );
        soccerEvents.push(...this.toRecordArray(upcoming?.events));
      }

      const uniqueSoccerEvents = this.uniqueTheSportsDbEvents(soccerEvents);
      summary.eventsRead = uniqueSoccerEvents.length;
      recordsRead += uniqueSoccerEvents.length;

      for (const event of uniqueSoccerEvents) {
        try {
          const result = await this.upsertTheSportsDbEvent({
            provider,
            event,
            fallbackSportCode: "football",
            dateFrom: isResultsBackfill ? backfillFromDate : undefined,
            dateTo: isResultsBackfill ? backfillToDate : undefined
          });
          if (result.skipped) {
            continue;
          }
          recordsWritten += 1;
          summary.matchesWritten += 1;
          if (result.matchId) {
            writtenMatchIds.push(result.matchId);
          }
          if (result.halfTimeSource) {
            halfTimeScoresWritten += 1;
            summary.halfTimeScoresWritten += 1;
            if (result.halfTimeSource === "timeline_derived") {
              timelineHalfTimeScoresWritten += 1;
              summary.timelineHalfTimeScoresWritten += 1;
            } else {
              directHalfTimeScoresWritten += 1;
              summary.directHalfTimeScoresWritten += 1;
            }
          }
        } catch (error) {
          errors += 1;
          const message = error instanceof Error ? error.message : "unknown";
          summary.errors.push(message);
          runErrors.push(`event:${leagueId}: ${message}`);
        }
      }

      const checkpointAfter = new Date().toISOString();
      await this.setCheckpoint(provider.key, checkpointEntityType, checkpointAfter);
      summary.checkpointAfter = checkpointAfter;
      perLeague.push(summary);
    }

    if (!isResultsBackfill) {
      for (const basketballLeagueId of basketballLeagueIds) {
        const response = await fetchWithQuota(
          `eventsseason/basketball/${basketballLeagueId}`,
          () => this.theSportsDbConnector.fetchUpcomingBasketballEvents(apiKey, basketballLeagueId, baseUrl)
        );
        const basketballEvents = this.uniqueTheSportsDbEvents(this.toRecordArray(response?.events));
        recordsRead += basketballEvents.length;
        for (const event of basketballEvents) {
          try {
            const result = await this.upsertTheSportsDbEvent({
              provider,
              event,
              fallbackSportCode: "basketball"
            });
            if (!result.skipped) {
              recordsWritten += 1;
            }
          } catch (error) {
            errors += 1;
            runErrors.push(`basketball:${basketballLeagueId}: ${error instanceof Error ? error.message : "unknown"}`);
          }
        }
      }
    }

    await this.createExternalPayload(provider.key, runId, "the_sports_db_events", {
      mode,
      provider: provider.key,
      leagues: soccerLeagueIds,
      soccerSeason,
      soccerBackfillFrom: backfillFromDate.toISOString().slice(0, 10),
      soccerBackfillTo: backfillToDate.toISOString().slice(0, 10),
      plannedCalls,
      attemptedCalls,
      successfulCalls,
      skippedDueQuota,
      perLeague,
      recordsRead,
      recordsWritten,
      halfTimeScoresWritten,
      directHalfTimeScoresWritten,
      timelineHalfTimeScoresWritten,
      errors: runErrors.slice(0, 50),
      quota: {
        used: quota.used,
        remaining: quota.remaining,
        limit: quota.limit
      }
    });

    return {
      providerKey: provider.key,
      recordsRead,
      recordsWritten,
      errors,
      details: {
        mode,
        leagues: soccerLeagueIds,
        soccerSeason,
        soccerBackfillFrom: backfillFromDate.toISOString().slice(0, 10),
        soccerBackfillTo: backfillToDate.toISOString().slice(0, 10),
        plannedCalls,
        attemptedCalls,
        successfulCalls,
        skippedDueQuota,
        recordsRead,
        recordsWritten,
        halfTimeScoresWritten,
        directHalfTimeScoresWritten,
        timelineHalfTimeScoresWritten,
        matchIds: this.uniqueStringList(writtenMatchIds),
        perLeague,
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
      soccerLeagueIds: string[];
      basketballLeagueIds: string[];
      dailyLimit: number;
    }
  ): Promise<ProviderSyncResult> {
    const leagueIds = Array.from(
      new Set([...options.soccerLeagueIds, ...options.basketballLeagueIds].map((item) => item.trim()).filter((item) => item.length > 0))
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
      soccerLeagueIds: string[];
      basketballLeagueIds: string[];
      dailyLimit: number;
    }
  ): Promise<ProviderSyncResult> {
    const leagueIds = Array.from(
      new Set([...options.soccerLeagueIds, ...options.basketballLeagueIds].map((item) => item.trim()).filter((item) => item.length > 0))
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
    let halfTimeScoresWritten = 0;
    let directHalfTimeScoresWritten = 0;
    let timelineHalfTimeScoresWritten = 0;
    const detailSummaries: Array<Record<string, unknown>> = [];

    for (const match of matchesToProcess) {
      const mapping = match.providerMappings.find((item: { providerMatchKey: string }) => /^\d+$/.test(item.providerMatchKey));
      if (!mapping) {
        continue;
      }
      const eventId = mapping.providerMatchKey;

      let eventRecord: Record<string, unknown> | null = null;
      let eventStats: Array<Record<string, unknown>> = [];
      let timeline: Array<Record<string, unknown>> = [];
      let refereeName: string | null = null;

      try {
        const startedEventAt = Date.now();
        const eventResponse = await this.theSportsDbConnector.lookupEvent(options.apiKey, eventId, options.baseUrl);
        await this.logApiCall(`provider/${provider.key}/lookupevent/${eventId}`, 200, Date.now() - startedEventAt, runId);
        const event = this.toRecordArray(eventResponse.events)[0];
        if (event) {
          eventRecord = event;
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
      let lineupRowsWritten = 0;
      let lineupPlayersWritten = 0;
      let teamStatsUpserted = 0;
      let timelineEventsWritten = 0;
      let halfTimeSource: TheSportsDbHalfTimeSource = null;

      try {
        const enrichmentWriteResult = await this.persistTheSportsDbEnrichment({
          provider,
          matchId: match.id,
          providerEventId: eventId,
          homeTeamId: match.homeTeam.id,
          awayTeamId: match.awayTeam.id,
          homeTeamName: match.homeTeam.name,
          awayTeamName: match.awayTeam.name,
          event: eventRecord,
          eventStats,
          timeline
        });
        lineupRowsWritten = enrichmentWriteResult.lineupRowsWritten;
        lineupPlayersWritten = enrichmentWriteResult.lineupPlayersWritten;
        teamStatsUpserted = enrichmentWriteResult.teamStatsUpserted;
        timelineEventsWritten = enrichmentWriteResult.timelineEventsWritten;
      } catch (error) {
        errors += 1;
        this.logger.warn(
          `TheSportsDB enrichment write failed for ${eventId}: ${error instanceof Error ? error.message : "unknown"}`
        );
      }

      if (eventRecord && !this.hasHalfTimePair(match.halfTimeHomeScore, match.halfTimeAwayScore)) {
        const directHalfTime = this.readTheSportsDbDirectHalfTimeScore(eventRecord);
        const resolvedHalfTime = this.hasHalfTimePair(directHalfTime.home, directHalfTime.away)
          ? directHalfTime
          : this.deriveTheSportsDbHalfTimeFromTimeline(timeline, match.homeTeam.name, match.awayTeam.name);

        if (this.hasHalfTimePair(resolvedHalfTime.home, resolvedHalfTime.away)) {
          try {
            await this.prisma.match.update({
              where: { id: match.id },
              data: {
                halfTimeHomeScore: resolvedHalfTime.home,
                halfTimeAwayScore: resolvedHalfTime.away,
                dataSource: match.dataSource ?? provider.key,
                importedAt: new Date(),
                updatedByProcess: "the_sports_db_match_details"
              }
            });
            halfTimeSource = resolvedHalfTime.source;
            halfTimeScoresWritten += 1;
            if (resolvedHalfTime.source === "timeline_derived") {
              timelineHalfTimeScoresWritten += 1;
            } else {
              directHalfTimeScoresWritten += 1;
            }
            await this.applyContextPatchToFeatureSnapshot(match.id, {
              theSportsDbHalfTimeSource: resolvedHalfTime.source,
              theSportsDbHalfTimeUpdatedAt: new Date().toISOString()
            });
          } catch (error) {
            errors += 1;
            this.logger.warn(
              `TheSportsDB half-time enrichment failed for ${eventId}: ${
                error instanceof Error ? error.message : "unknown"
              }`
            );
          }
        }
      }

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
        aliasConfidence,
        lineupRowsWritten,
        lineupPlayersWritten,
        teamStatsUpserted,
        timelineEventsWritten,
        halfTimeSource: halfTimeSource ?? "missing"
      });
      recordsWritten += 1;
    }

    const cursor = new Date().toISOString();
    await this.setCheckpoint(provider.key, "the_sports_db_match_details", cursor);
    await this.createExternalPayload(provider.key, runId, "the_sports_db_match_details", {
      recordsRead: matches.length,
      recordsWritten,
      halfTimeScoresWritten,
      directHalfTimeScoresWritten,
      timelineHalfTimeScoresWritten,
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
        halfTimeScoresWritten,
        directHalfTimeScoresWritten,
        timelineHalfTimeScoresWritten,
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
    const syncDaysBack = this.parseConfigInt(settings.syncDaysBack, 1);
    const syncDaysAhead = this.parseConfigInt(settings.syncDaysAhead, 1);
    const defaultDateFrom = this.todayDateString(-syncDaysBack);
    const dateTo = this.todayDateString(1);
    const dayOffsets =
      jobType === "syncResults"
        ? Array.from({ length: syncDaysBack + 1 }, (_, index) => index - syncDaysBack)
        : Array.from({ length: syncDaysAhead + 1 }, (_, index) => index);
    const fallbackTargetDates = dayOffsets.map((offset) => this.todayDateString(offset));
    const checkpoint =
      jobType === "syncResults" ? await this.getCheckpoint(provider.key, "football_matches_results") : null;
    const targetPlan =
      jobType === "syncResults"
        ? this.buildResultBackfillTargetDates(
            checkpoint ?? null,
            defaultDateFrom,
            dateTo,
            fallbackTargetDates,
            dailyLimit
          )
        : {
            targetDates: fallbackTargetDates,
            usedCheckpoint: false,
            nextCheckpoint: null as string | null
          };
    const targetDates = targetPlan.targetDates;
    const requestedCalls = Math.max(1, targetDates.length);

    const quota = await this.quotaGate(provider.key, requestedCalls, dailyLimit);
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
          requestedCalls,
          used: quota.used,
          remaining: quota.remaining
        }
      };
    }

    const fixtureBuckets: Array<{ date: string; fixtures: Array<Record<string, unknown>> }> = [];
    for (const targetDate of targetDates) {
      const startedAt = Date.now();
      const response = await this.apiFootballConnector.fetchFixtures(
        settings.apiKey,
        targetDate,
        settings.baseUrl ?? provider.baseUrl ?? undefined
      );
      const durationMs = Date.now() - startedAt;
      await this.logApiCall(`provider/${provider.key}/fixtures`, 200, durationMs, runId);
      fixtureBuckets.push({
        date: targetDate,
        fixtures: response.response ?? []
      });
    }

    const fixtures = fixtureBuckets.flatMap((bucket) => bucket.fixtures);
    const leagueIdFilters = Array.from(
      new Set(
        [settings.leagueId, ...(settings.leagueIds ?? [])]
          .map((value) => String(value ?? "").trim())
          .filter((value) => value.length > 0)
      )
    );
    const leagueFilter = settings.leagueId?.trim();
    const seasonFilter = settings.season?.trim();

    let written = 0;
    let errors = 0;

    for (const fixtureEntry of fixtures) {
      const fixture = (fixtureEntry.fixture as Record<string, unknown> | undefined) ?? {};
      const league = (fixtureEntry.league as Record<string, unknown> | undefined) ?? {};
      const teams = (fixtureEntry.teams as Record<string, unknown> | undefined) ?? {};
      const goals = (fixtureEntry.goals as Record<string, unknown> | undefined) ?? {};
      const score = (fixtureEntry.score as Record<string, unknown> | undefined) ?? {};
      const halfTimeScore = (score.halftime as Record<string, unknown> | undefined) ?? {};
      const halfTimeFromNested = this.readHalfTimeScorePair(halfTimeScore);
      const halfTimeFromScore = this.readHalfTimeScorePair(score);
      const halfTimeFromFixture = this.readHalfTimeScorePair(fixtureEntry);
      const halfTimeHomeScore = halfTimeFromNested.home ?? halfTimeFromScore.home ?? halfTimeFromFixture.home;
      const halfTimeAwayScore = halfTimeFromNested.away ?? halfTimeFromScore.away ?? halfTimeFromFixture.away;

      if (leagueIdFilters.length > 0 && !leagueIdFilters.includes(String(league.id ?? "").trim())) {
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
        halfTimeHomeScore,
        halfTimeAwayScore,
        refereeName,
        dataSource: provider.key
      });
      written += 1;
    }

    await this.createExternalPayload(provider.key, runId, "api_football_fixtures", {
      targetDates,
      jobType,
      dailyLimit,
      requestedCalls,
      checkpoint,
      checkpointBackfill: targetPlan.usedCheckpoint,
      nextCheckpoint: targetPlan.nextCheckpoint,
      leagueIdFilters,
      leagueFilter: leagueFilter ?? null,
      seasonFilter: seasonFilter ?? null,
      recordsRead: fixtures.length,
      recordsWritten: written,
      errors
    });

    if (targetPlan.usedCheckpoint && targetPlan.nextCheckpoint) {
      await this.setCheckpoint(provider.key, "football_matches_results", targetPlan.nextCheckpoint);
    }

    return {
      providerKey: provider.key,
      recordsRead: fixtures.length,
      recordsWritten: written,
      errors,
      details: {
        targetDates,
        jobType,
        dailyLimit,
        requestedCalls,
        checkpointBackfill: targetPlan.usedCheckpoint,
        nextCheckpoint: targetPlan.nextCheckpoint,
        leagueIdFilters,
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
      const q1HomeScore = this.readQuarterScoreFromSideScores(homeScores, 1);
      const q1AwayScore = this.readQuarterScoreFromSideScores(awayScores, 1);
      const q2HomeScore = this.readQuarterScoreFromSideScores(homeScores, 2);
      const q2AwayScore = this.readQuarterScoreFromSideScores(awayScores, 2);
      const q3HomeScore = this.readQuarterScoreFromSideScores(homeScores, 3);
      const q3AwayScore = this.readQuarterScoreFromSideScores(awayScores, 3);
      const q4HomeScore = this.readQuarterScoreFromSideScores(homeScores, 4);
      const q4AwayScore = this.readQuarterScoreFromSideScores(awayScores, 4);
      const inferredHalf = this.buildHalfTimeFromQuarters(q1HomeScore, q1AwayScore, q2HomeScore, q2AwayScore);

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
        halfTimeHomeScore: inferredHalf.halfTimeHomeScore,
        halfTimeAwayScore: inferredHalf.halfTimeAwayScore,
        q1HomeScore,
        q1AwayScore,
        q2HomeScore,
        q2AwayScore,
        q3HomeScore,
        q3AwayScore,
        q4HomeScore,
        q4AwayScore,
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
      const q1HomeScore = this.readQuarterScoreFromSideScores(homeScoreObj, 1);
      const q1AwayScore = this.readQuarterScoreFromSideScores(awayScoreObj, 1);
      const q2HomeScore = this.readQuarterScoreFromSideScores(homeScoreObj, 2);
      const q2AwayScore = this.readQuarterScoreFromSideScores(awayScoreObj, 2);
      const q3HomeScore = this.readQuarterScoreFromSideScores(homeScoreObj, 3);
      const q3AwayScore = this.readQuarterScoreFromSideScores(awayScoreObj, 3);
      const q4HomeScore = this.readQuarterScoreFromSideScores(homeScoreObj, 4);
      const q4AwayScore = this.readQuarterScoreFromSideScores(awayScoreObj, 4);
      const inferredHalf = this.buildHalfTimeFromQuarters(q1HomeScore, q1AwayScore, q2HomeScore, q2AwayScore);
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
        halfTimeHomeScore: inferredHalf.halfTimeHomeScore,
        halfTimeAwayScore: inferredHalf.halfTimeAwayScore,
        q1HomeScore,
        q1AwayScore,
        q2HomeScore,
        q2AwayScore,
        q3HomeScore,
        q3AwayScore,
        q4HomeScore,
        q4AwayScore,
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
    const defaultDateFrom = this.todayDateString(-syncDaysBack);
    const dateTo = this.todayDateString(1);
    const offsets =
      jobType === "syncResults"
        ? Array.from({ length: syncDaysBack + 1 }, (_, index) => index - syncDaysBack)
        : Array.from({ length: syncDaysAhead + 1 }, (_, index) => index);
    const fallbackTargetDates = offsets.map((offset) => this.todayDateString(offset));
    const checkpoint =
      jobType === "syncResults" ? await this.getCheckpoint(provider.key, "football_matches_results") : null;
    const targetPlan =
      jobType === "syncResults"
        ? this.buildResultBackfillTargetDates(
            checkpoint ?? null,
            defaultDateFrom,
            dateTo,
            fallbackTargetDates,
            dailyLimit
          )
        : {
            targetDates: fallbackTargetDates,
            usedCheckpoint: false,
            nextCheckpoint: null as string | null
          };

    const quota = await this.quotaGate(provider.key, targetPlan.targetDates.length, dailyLimit);
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
          plannedCalls: targetPlan.targetDates.length
        }
      };
    }

    let recordsRead = 0;
    let recordsWritten = 0;
    let errors = 0;

    for (const targetDate of targetPlan.targetDates) {
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
          halfTimeHomeScore: this.readHalfTimeScore(fixtureRecord, "home"),
          halfTimeAwayScore: this.readHalfTimeScore(fixtureRecord, "away"),
          refereeName,
          dataSource: provider.key
        });
        recordsWritten += 1;
      }
    }

    if (targetPlan.usedCheckpoint && targetPlan.nextCheckpoint) {
      await this.setCheckpoint(provider.key, "football_matches_results", targetPlan.nextCheckpoint);
    }

    await this.createExternalPayload(provider.key, runId, "sportapi_fixtures", {
      mode: jobType,
      syncDaysBack,
      syncDaysAhead,
      offsets,
      targetDates: targetPlan.targetDates,
      checkpoint,
      checkpointBackfill: targetPlan.usedCheckpoint,
      nextCheckpoint: targetPlan.nextCheckpoint,
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
        calls: targetPlan.targetDates.length,
        checkpointBackfill: targetPlan.usedCheckpoint,
        nextCheckpoint: targetPlan.nextCheckpoint,
        dailyLimit
      }
    };
  }
}

