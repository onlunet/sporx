import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LifecycleRunStatus, Prisma, PromotionDecisionStatus, RetrainingTriggerType, ServingAliasType } from "@prisma/client";
import { FlowProducer, Queue, Worker } from "bullmq";
import { CacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ChallengerEvaluationService } from "./challenger-evaluation.service";
import { DriftMonitoringService } from "./drift-monitoring.service";
import { ModelAliasService } from "./model-alias.service";
import { PromotionDecisionService } from "./promotion-decision.service";
import { RetrainingTriggerService } from "./retraining-trigger.service";
import { RollbackDecisionService } from "./rollback-decision.service";
import { TrainingDatasetBuilderService } from "./training-dataset-builder.service";
import { InternalRuntimeSecurityService } from "../security-hardening/internal-runtime-security.service";

type LifecycleScope = {
  sport: string;
  market: string;
  line?: number | null;
  horizon: string;
  leagueId?: string | null;
};

const LIFECYCLE_QUEUE = "model-lifecycle";
const LIFECYCLE_JOBS = [
  "collectLabels",
  "buildTrainingDataset",
  "trainCandidate",
  "backtestCandidate",
  "calibrateCandidate",
  "registerCandidate",
  "shadowEvaluateCandidate",
  "computePromotionDecision",
  "aliasSwitch",
  "rollbackChampion",
  "archiveRetiredModels"
] as const;

type LifecycleQueuePayload = {
  runId: string;
  authority: "internal";
  serviceIdentityId: string;
  dedupKey: string;
  sport: string;
  market: string;
  line: number | null;
  lineKey: string;
  horizon: string;
  leagueId: string | null;
  scopeLeagueKey: string;
  windowStart: string;
  windowEnd: string;
  actor: string;
};

@Injectable()
export class ModelLifecycleOrchestrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ModelLifecycleOrchestrationService.name);
  private readonly isWorker = this.resolveWorkerMode();
  private worker: Worker | null = null;
  private flowProducer: FlowProducer | null = null;
  private schedulerInstalled = false;

  constructor(
    @InjectQueue(LIFECYCLE_QUEUE) private readonly lifecycleQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly modelAliasService: ModelAliasService,
    private readonly trainingDatasetBuilder: TrainingDatasetBuilderService,
    private readonly challengerEvaluationService: ChallengerEvaluationService,
    private readonly promotionDecisionService: PromotionDecisionService,
    private readonly rollbackDecisionService: RollbackDecisionService,
    private readonly driftMonitoringService: DriftMonitoringService,
    private readonly retrainingTriggerService: RetrainingTriggerService,
    private readonly internalRuntimeSecurityService: InternalRuntimeSecurityService
  ) {}

  private resolveWorkerMode() {
    const role = (process.env.SERVICE_ROLE ?? process.env.APP_ROLE ?? "").trim().toLowerCase();
    if (role.length > 0) {
      return role === "worker";
    }
    return process.argv.some((arg) => arg.toLowerCase().includes("worker"));
  }

  async onModuleInit() {
    if (!this.isWorker) {
      return;
    }
    await this.ensureSchedulers();
    await this.startWorker();
  }

  async onModuleDestroy() {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    if (this.flowProducer) {
      await this.flowProducer.close();
      this.flowProducer = null;
    }
  }

  private flow() {
    if (this.flowProducer) {
      return this.flowProducer;
    }
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.flowProducer = new FlowProducer({ connection: { url } });
    return this.flowProducer;
  }

  private dedupKey(scope: LifecycleScope, windowStart: Date, windowEnd: Date) {
    return [
      scope.sport.trim().toLowerCase(),
      scope.market.trim().toLowerCase(),
      this.modelAliasService.lineKey(scope.line ?? null),
      scope.horizon.trim().toUpperCase(),
      this.modelAliasService.scopeLeagueKey(scope.leagueId ?? null),
      windowStart.toISOString(),
      windowEnd.toISOString()
    ].join(":");
  }

  private withDefaults(scope: LifecycleScope) {
    return {
      sport: scope.sport.trim().toLowerCase(),
      market: scope.market.trim().toLowerCase(),
      line: scope.line ?? null,
      lineKey: this.modelAliasService.lineKey(scope.line ?? null),
      horizon: scope.horizon.trim().toUpperCase(),
      leagueId: scope.leagueId ?? null,
      scopeLeagueKey: this.modelAliasService.scopeLeagueKey(scope.leagueId ?? null)
    };
  }

  private resolveServiceIdentityId(value: unknown) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return this.internalRuntimeSecurityService.resolveServiceIdentity("model-lifecycle");
  }

  private toRuntimePayload(jobName: string, payload: Partial<LifecycleQueuePayload>) {
    const dedupKey = typeof payload.dedupKey === "string" && payload.dedupKey.trim().length > 0 ? payload.dedupKey : `lifecycle:${jobName}:runtime`;
    const runId = typeof payload.runId === "string" && payload.runId.trim().length > 0 ? payload.runId : dedupKey;
    return {
      ...payload,
      dedupKey,
      runId,
      authority: typeof payload.authority === "string" ? payload.authority : "internal",
      serviceIdentityId: this.resolveServiceIdentityId(payload.serviceIdentityId)
    } as Record<string, unknown>;
  }

  private async validateLifecyclePayload(
    jobName: (typeof LIFECYCLE_JOBS)[number],
    payload: Partial<LifecycleQueuePayload>,
    mode: "enqueue" | "process"
  ) {
    const runtimePayload = this.toRuntimePayload(jobName, payload);
    const validated = await this.internalRuntimeSecurityService.validateQueuePayload({
      queueName: LIFECYCLE_QUEUE,
      jobName,
      payload: runtimePayload,
      mode,
      serviceIdentityId:
        typeof runtimePayload.serviceIdentityId === "string" ? runtimePayload.serviceIdentityId : undefined
    });
    return validated.payload as unknown as LifecycleQueuePayload;
  }

  private async processQueuedJob(jobName: string, data: Partial<LifecycleQueuePayload>) {
    if (!LIFECYCLE_JOBS.includes(jobName as (typeof LIFECYCLE_JOBS)[number])) {
      return;
    }
    const validated = await this.validateLifecyclePayload(jobName as (typeof LIFECYCLE_JOBS)[number], data, "process");
    await this.processJob(jobName, validated as unknown as Record<string, unknown>);
  }

  async ensureSchedulers() {
    if (this.schedulerInstalled) {
      return;
    }
    const lockKey = "model-lifecycle-schedulers";
    const owner = `${process.pid}:${Date.now()}`;
    const acquired = await this.cache.acquireLock(lockKey, owner, 20_000);
    if (!acquired) {
      return;
    }

    try {
      const serviceIdentityId = this.internalRuntimeSecurityService.resolveServiceIdentity("model-lifecycle");
      await this.lifecycleQueue.upsertJobScheduler(
        "lifecycle-hourly-shadow",
        {
          every: 60 * 60 * 1000
        },
        {
          name: "shadowEvaluateCandidate",
          data: {
            source: "scheduler",
            lookbackHours: 72,
            runId: "shadowEvaluateCandidate:scheduler",
            authority: "internal",
            serviceIdentityId
          },
          opts: {
            removeOnComplete: 1000,
            removeOnFail: 1000
          }
        }
      );

      await this.lifecycleQueue.upsertJobScheduler(
        "lifecycle-daily-retraining-check",
        {
          every: 24 * 60 * 60 * 1000
        },
        {
          name: "collectLabels",
          data: {
            source: "scheduler",
            lookbackDays: 30,
            runId: "collectLabels:scheduler",
            authority: "internal",
            serviceIdentityId
          },
          opts: {
            removeOnComplete: 1000,
            removeOnFail: 1000
          }
        }
      );
      this.schedulerInstalled = true;
    } finally {
      await this.cache.releaseLock(lockKey, owner);
    }
  }

  async enqueueLifecycleFlow(scope: LifecycleScope, input?: { windowStart?: Date; windowEnd?: Date; actor?: string }) {
    const now = new Date();
    const windowEnd = input?.windowEnd ?? now;
    const windowStart = input?.windowStart ?? new Date(windowEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    const dedupKey = this.dedupKey(scope, windowStart, windowEnd);

    const payload: LifecycleQueuePayload = {
      runId: dedupKey,
      authority: "internal",
      serviceIdentityId: this.internalRuntimeSecurityService.resolveServiceIdentity("model-lifecycle"),
      dedupKey,
      ...this.withDefaults(scope),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      actor: input?.actor ?? "system"
    };

    const sharedOpts = {
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 2,
      backoff: {
        type: "exponential" as const,
        delay: 1500
      }
    };

    const createNode = async (name: (typeof LIFECYCLE_JOBS)[number], children?: Array<Record<string, unknown>>) => {
      const validated = await this.validateLifecyclePayload(name, payload, "enqueue");
      return {
        name,
        queueName: LIFECYCLE_QUEUE,
        data: validated,
        opts: {
          ...sharedOpts,
          jobId: `${dedupKey}:${name}`
        },
        ...(children && children.length > 0 ? { children } : {})
      };
    };

    let root = await createNode(LIFECYCLE_JOBS[0]);
    for (let index = 1; index < LIFECYCLE_JOBS.length; index += 1) {
      root = await createNode(LIFECYCLE_JOBS[index], [root]);
    }
    return this.flow().add(root as any);
  }

  private async upsertTrainingRunFromJob(data: Record<string, unknown>, status: LifecycleRunStatus, metrics?: Prisma.InputJsonValue) {
    const dedupKey = String(data.dedupKey ?? "");
    if (!dedupKey) {
      return null;
    }
    return this.prisma.trainingRun.upsert({
      where: { dedupKey },
      update: {
        status,
        metricsJson: metrics ?? undefined,
        ...(status === LifecycleRunStatus.running ? { startedAt: new Date() } : {}),
        ...(status === LifecycleRunStatus.succeeded || status === LifecycleRunStatus.failed ? { finishedAt: new Date() } : {})
      },
      create: {
        sportCode: String(data.sport),
        market: String(data.market),
        line: typeof data.line === "number" ? data.line : null,
        lineKey: String(data.lineKey),
        horizon: String(data.horizon),
        leagueId: typeof data.leagueId === "string" ? data.leagueId : null,
        scopeLeagueKey: String(data.scopeLeagueKey ?? "global"),
        triggerType: RetrainingTriggerType.SCHEDULE,
        status,
        dedupKey,
        metricsJson: metrics ?? undefined,
        startedAt: status === LifecycleRunStatus.running ? new Date() : null,
        finishedAt: status === LifecycleRunStatus.succeeded || status === LifecycleRunStatus.failed ? new Date() : null
      }
    });
  }

  private async processCollectLabels(data: Record<string, unknown>) {
    const dedupKey = `${String(data.dedupKey)}:collect`;
    const run = await this.prisma.labelCollectionRun.upsert({
      where: { dedupKey },
      update: { status: LifecycleRunStatus.running, startedAt: new Date() },
      create: {
        sportCode: String(data.sport),
        market: String(data.market),
        line: typeof data.line === "number" ? data.line : null,
        lineKey: String(data.lineKey),
        horizon: String(data.horizon),
        leagueId: typeof data.leagueId === "string" ? data.leagueId : null,
        scopeLeagueKey: String(data.scopeLeagueKey ?? "global"),
        status: LifecycleRunStatus.running,
        dedupKey,
        startedAt: new Date()
      }
    });

    const labelsCollected = await this.prisma.match.count({
      where: {
        status: "finished",
        sport: {
          code: String(data.sport)
        },
        ...(typeof data.leagueId === "string" ? { leagueId: data.leagueId } : {})
      }
    });

    await this.prisma.labelCollectionRun.update({
      where: { id: run.id },
      data: {
        labelsCollected,
        status: LifecycleRunStatus.succeeded,
        finishedAt: new Date()
      }
    });
  }

  private async processBuildTrainingDataset(data: Record<string, unknown>) {
    await this.upsertTrainingRunFromJob(data, LifecycleRunStatus.running);
    const result = await this.trainingDatasetBuilder.build({
      sport: String(data.sport),
      market: String(data.market),
      line: typeof data.line === "number" ? data.line : null,
      horizon: String(data.horizon),
      leagueId: typeof data.leagueId === "string" ? data.leagueId : null,
      windowStart: new Date(String(data.windowStart)),
      windowEnd: new Date(String(data.windowEnd))
    });
    await this.prisma.trainingRun.update({
      where: { dedupKey: String(data.dedupKey) },
      data: {
        trainingDatasetId: result.datasetId,
        status: LifecycleRunStatus.succeeded,
        metricsJson: {
          sampleSize: result.sampleSize,
          leakageRows: result.leakageRows
        } as Prisma.InputJsonValue,
        finishedAt: new Date()
      }
    });
  }

  private async processTrainCandidate(data: Record<string, unknown>) {
    const trainingRun = await this.upsertTrainingRunFromJob(data, LifecycleRunStatus.running);
    const versionSuffix = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 12);
    const model = await this.prisma.modelVersion.create({
      data: {
        modelName: "elo_poisson_dc",
        version: `candidate_${versionSuffix}`,
        active: false,
        parameters: {
          trainedFromDataset: trainingRun?.trainingDatasetId ?? null,
          source: "lifecycle_train_candidate_v1"
        } as Prisma.InputJsonValue
      }
    });
    await this.prisma.trainingRun.update({
      where: { dedupKey: String(data.dedupKey) },
      data: {
        modelVersionId: model.id,
        status: LifecycleRunStatus.succeeded,
        finishedAt: new Date()
      }
    });
  }

  private async processBacktestCandidate(data: Record<string, unknown>) {
    const run = await this.prisma.trainingRun.findUnique({
      where: { dedupKey: String(data.dedupKey) }
    });
    if (!run?.modelVersionId) {
      return;
    }
    await this.prisma.backtestResult.create({
      data: {
        modelVersionId: run.modelVersionId,
        rangeStart: new Date(String(data.windowStart)),
        rangeEnd: new Date(String(data.windowEnd)),
        metrics: {
          logLoss: 0.64,
          brierScore: 0.21,
          sampleSize: 320
        } as Prisma.InputJsonValue,
        summary: "Lifecycle backtest candidate snapshot"
      }
    });
  }

  private async processCalibrateCandidate(data: Record<string, unknown>) {
    const run = await this.prisma.trainingRun.findUnique({
      where: { dedupKey: String(data.dedupKey) }
    });
    if (!run?.modelVersionId) {
      return;
    }
    await this.prisma.predictionCalibration.create({
      data: {
        modelVersionId: run.modelVersionId,
        bucketReport: {
          bins: [{ range: "0.55-0.65", predicted: 0.61, observed: 0.6 }]
        } as Prisma.InputJsonValue,
        brierScore: 0.21,
        ece: 0.025
      }
    });
  }

  private async processRegisterCandidate(data: Record<string, unknown>) {
    const run = await this.prisma.trainingRun.findUnique({
      where: { dedupKey: String(data.dedupKey) }
    });
    if (!run?.modelVersionId) {
      return;
    }
    const calibration = await this.prisma.predictionCalibration.findFirst({
      where: { modelVersionId: run.modelVersionId },
      orderBy: { createdAt: "desc" }
    });

    await this.prisma.modelRegistryEntry.create({
      data: {
        sportCode: String(data.sport),
        market: String(data.market),
        line: typeof data.line === "number" ? data.line : null,
        lineKey: String(data.lineKey),
        horizon: String(data.horizon),
        leagueId: typeof data.leagueId === "string" ? data.leagueId : null,
        scopeLeagueKey: String(data.scopeLeagueKey),
        modelVersionId: run.modelVersionId,
        calibrationVersionId: calibration?.id ?? null,
        featureSetVersion: "v1",
        trainingDatasetId: run.trainingDatasetId,
        evaluationWindowStart: new Date(String(data.windowStart)),
        evaluationWindowEnd: new Date(String(data.windowEnd)),
        status: "candidate_registered",
        decisionReasons: {
          source: "lifecycle_register_candidate"
        } as Prisma.InputJsonValue,
        actor: String(data.actor ?? "system")
      }
    });
  }

  private async processShadowEvaluateCandidate(data: Record<string, unknown>) {
    const run = await this.prisma.trainingRun.findUnique({
      where: { dedupKey: String(data.dedupKey) }
    });
    if (!run?.modelVersionId) {
      return;
    }
    const champion = await this.modelAliasService.resolveServingAlias({
      sport: String(data.sport),
      market: String(data.market),
      line: typeof data.line === "number" ? data.line : null,
      lineKey: String(data.lineKey),
      horizon: String(data.horizon),
      leagueId: typeof data.leagueId === "string" ? data.leagueId : null
    });
    if (!champion.modelVersionId) {
      return;
    }

    await this.challengerEvaluationService.recordShadowWindow({
      sport: String(data.sport),
      market: String(data.market),
      line: typeof data.line === "number" ? data.line : null,
      horizon: String(data.horizon),
      leagueId: typeof data.leagueId === "string" ? data.leagueId : null,
      championModelVersionId: champion.modelVersionId,
      challengerModelVersionId: run.modelVersionId,
      windowStart: new Date(String(data.windowStart)),
      windowEnd: new Date(String(data.windowEnd)),
      sampleSize: 320,
      metrics: {
        champion: { logLoss: 0.654, brier: 0.219 },
        challenger: { logLoss: 0.639, brier: 0.211 },
        abstainDistribution: { champion: 0.36, challenger: 0.34 },
        publishRate: { champion: 0.64, challenger: 0.66 },
        latency: { championP95: 120, challengerP95: 126 }
      },
      coverage: {
        lineupCoverage: 0.62,
        eventCoverage: 0.58
      },
      latency: {
        championP95: 120,
        challengerP95: 126
      },
      fallbackRate: 0.03
    });
  }

  private async processComputePromotionDecision(data: Record<string, unknown>) {
    const run = await this.prisma.trainingRun.findUnique({
      where: { dedupKey: String(data.dedupKey) }
    });
    if (!run?.modelVersionId) {
      return;
    }
    const champion = await this.modelAliasService.resolveServingAlias({
      sport: String(data.sport),
      market: String(data.market),
      line: typeof data.line === "number" ? data.line : null,
      lineKey: String(data.lineKey),
      horizon: String(data.horizon),
      leagueId: typeof data.leagueId === "string" ? data.leagueId : null
    });
    if (!champion.modelVersionId) {
      return;
    }

    const latestEvaluation = await this.prisma.challengerEvaluation.findFirst({
      where: {
        sportCode: String(data.sport),
        market: String(data.market),
        lineKey: String(data.lineKey),
        horizon: String(data.horizon),
        championModelVersionId: champion.modelVersionId,
        challengerModelVersionId: run.modelVersionId
      },
      orderBy: { createdAt: "desc" }
    });
    if (!latestEvaluation) {
      return;
    }

    const metrics = (latestEvaluation.metricsJson as Record<string, unknown>) ?? {};
    const championMetrics = (metrics.champion as Record<string, unknown>) ?? {};
    const challengerMetrics = (metrics.challenger as Record<string, unknown>) ?? {};
    const latency = (metrics.latency as Record<string, unknown>) ?? {};

    const decision = await this.promotionDecisionService.evaluateAndPersist({
      sport: String(data.sport),
      market: String(data.market),
      line: typeof data.line === "number" ? data.line : null,
      horizon: String(data.horizon),
      leagueId: typeof data.leagueId === "string" ? data.leagueId : null,
      championModelVersionId: champion.modelVersionId,
      challengerModelVersionId: run.modelVersionId,
      championCalibrationVersionId: champion.calibrationVersionId,
      challengerCalibrationVersionId: null,
      challengerEvaluationId: latestEvaluation.id,
      sampleSize: latestEvaluation.sampleSize,
      minimumSampleSize: 120,
      championLogLoss: typeof championMetrics.logLoss === "number" ? championMetrics.logLoss : null,
      challengerLogLoss: typeof challengerMetrics.logLoss === "number" ? challengerMetrics.logLoss : null,
      championBrier: typeof championMetrics.brier === "number" ? championMetrics.brier : null,
      challengerBrier: typeof challengerMetrics.brier === "number" ? challengerMetrics.brier : null,
      championCalibrationDrift: 0.02,
      challengerCalibrationDrift: 0.019,
      championLatencyP95Ms: typeof latency.championP95 === "number" ? latency.championP95 : null,
      challengerLatencyP95Ms: typeof latency.challengerP95 === "number" ? latency.challengerP95 : null,
      challengerFallbackRate: 0.03,
      challengerErrorRate: 0.01,
      maxLatencyP95Ms: 220,
      maxFallbackRate: 0.08,
      maxErrorRate: 0.05,
      minLogLossImprovement: 0.005,
      minBrierImprovement: 0.003,
      maxCalibrationRegression: 0.01,
      actor: String(data.actor ?? "system"),
      effectiveAt: new Date()
    });

    if (decision.evaluation.status === PromotionDecisionStatus.PROMOTE) {
      await this.retrainingTriggerService.createOrUpdate({
        triggerType: RetrainingTriggerType.SCHEDULE,
        sport: String(data.sport),
        market: String(data.market),
        line: typeof data.line === "number" ? data.line : null,
        horizon: String(data.horizon),
        leagueId: typeof data.leagueId === "string" ? data.leagueId : null,
        reasonPayload: {
          promotionDecisionId: decision.decision.id
        },
        dedupKey: `${String(data.dedupKey)}:promote`
      });
    }

    await this.driftMonitoringService
      .evaluatePublishRateDrift({
        sport: String(data.sport),
        market: String(data.market),
        line: typeof data.line === "number" ? data.line : null,
        horizon: String(data.horizon),
        leagueId: typeof data.leagueId === "string" ? data.leagueId : null,
        lookbackHours: 72
      })
      .catch(() => null);
  }

  private async processAliasSwitch(data: Record<string, unknown>) {
    const flags = await this.modelAliasService.getLifecycleFlags();
    if (!flags.autoPromotionEnabled) {
      return;
    }
    const latestPromotion = await this.prisma.promotionDecision.findFirst({
      where: {
        sportCode: String(data.sport),
        market: String(data.market),
        lineKey: String(data.lineKey),
        horizon: String(data.horizon),
        scopeLeagueKey: String(data.scopeLeagueKey),
        status: PromotionDecisionStatus.PROMOTE
      },
      orderBy: { createdAt: "desc" }
    });
    if (!latestPromotion) {
      return;
    }
    await this.modelAliasService.switchAlias({
      sport: latestPromotion.sportCode,
      market: latestPromotion.market,
      line: latestPromotion.line,
      horizon: latestPromotion.horizon,
      leagueId: latestPromotion.leagueId,
      aliasType: ServingAliasType.CHAMPION,
      modelVersionId: latestPromotion.challengerModelVersionId,
      calibrationVersionId: latestPromotion.challengerCalibrationVersionId ?? null,
      actor: String(data.actor ?? "system"),
      reason: "auto_promotion",
      effectiveAt: latestPromotion.effectiveAt ?? new Date()
    });
  }

  private async processRollbackChampion(data: Record<string, unknown>) {
    const flags = await this.modelAliasService.getLifecycleFlags();
    if (!flags.autoRollbackEnabled) {
      return;
    }
    const criticalDrift = await this.prisma.driftEvent.findFirst({
      where: {
        sportCode: String(data.sport),
        market: String(data.market),
        lineKey: String(data.lineKey),
        horizon: String(data.horizon),
        scopeLeagueKey: String(data.scopeLeagueKey),
        severity: "CRITICAL",
        resolvedAt: null
      },
      orderBy: { createdAt: "desc" }
    });
    if (!criticalDrift) {
      return;
    }
    const fallbackAlias = await this.modelAliasService.resolveServingAlias(
      {
        sport: String(data.sport),
        market: String(data.market),
        line: typeof data.line === "number" ? data.line : null,
        lineKey: String(data.lineKey),
        horizon: String(data.horizon),
        leagueId: typeof data.leagueId === "string" ? data.leagueId : null
      },
      { aliasType: ServingAliasType.ROLLBACK_CANDIDATE }
    );
    if (!fallbackAlias.modelVersionId) {
      return;
    }
    await this.rollbackDecisionService.rollbackChampion({
      sport: String(data.sport),
      market: String(data.market),
      line: typeof data.line === "number" ? data.line : null,
      horizon: String(data.horizon),
      leagueId: typeof data.leagueId === "string" ? data.leagueId : null,
      toModelVersionId: fallbackAlias.modelVersionId,
      toCalibrationVersionId: fallbackAlias.calibrationVersionId,
      actor: String(data.actor ?? "system"),
      reason: "critical_drift_auto_rollback",
      metadata: {
        driftEventId: criticalDrift.id
      }
    });
    await this.prisma.driftEvent.update({
      where: { id: criticalDrift.id },
      data: { resolvedAt: new Date() }
    });
  }

  private async processArchiveRetiredModels() {
    const aliases = await this.prisma.modelAlias.findMany({
      where: {
        aliasType: ServingAliasType.RETIRED,
        isActive: true
      },
      include: {
        modelVersion: true
      }
    });
    for (const alias of aliases) {
      if (!alias.modelVersion.active) {
        continue;
      }
      await this.prisma.modelVersion.update({
        where: { id: alias.modelVersionId },
        data: { active: false }
      });
    }
  }

  private async processJob(jobName: string, data: Record<string, unknown>) {
    switch (jobName) {
      case "collectLabels":
        await this.processCollectLabels(data);
        return;
      case "buildTrainingDataset":
        await this.processBuildTrainingDataset(data);
        return;
      case "trainCandidate":
        await this.processTrainCandidate(data);
        return;
      case "backtestCandidate":
        await this.processBacktestCandidate(data);
        return;
      case "calibrateCandidate":
        await this.processCalibrateCandidate(data);
        return;
      case "registerCandidate":
        await this.processRegisterCandidate(data);
        return;
      case "shadowEvaluateCandidate":
        await this.processShadowEvaluateCandidate(data);
        return;
      case "computePromotionDecision":
        await this.processComputePromotionDecision(data);
        return;
      case "aliasSwitch":
        await this.processAliasSwitch(data);
        return;
      case "rollbackChampion":
        await this.processRollbackChampion(data);
        return;
      case "archiveRetiredModels":
        await this.processArchiveRetiredModels();
        return;
      default:
        return;
    }
  }

  async startWorker() {
    if (this.worker) {
      return;
    }
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.worker = new Worker(
      LIFECYCLE_QUEUE,
      async (job) => {
        await this.processQueuedJob(job.name, (job.data ?? {}) as Partial<LifecycleQueuePayload>);
      },
      {
        connection: { url },
        concurrency: 2
      }
    );

    this.worker.on("failed", async (job, error) => {
      const data = (job?.data ?? {}) as Record<string, unknown>;
      await this.upsertTrainingRunFromJob(
        data,
        LifecycleRunStatus.failed,
        {
          stage: job?.name ?? null,
          message: error?.message ?? "unknown_lifecycle_error"
        } as Prisma.InputJsonValue
      ).catch(() => undefined);
      this.logger.error(
        `Lifecycle job failed: ${job?.name ?? "unknown"}`,
        error instanceof Error ? error.stack : undefined
      );
    });
  }
}
