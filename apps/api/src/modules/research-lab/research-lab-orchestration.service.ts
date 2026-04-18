import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma, ResearchRunStatus, StrategyObjective, TuningSearchType } from "@prisma/client";
import { FlowProducer, Queue, Worker } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { stableHash } from "./research-lab.hash";
import { ExperimentTrackingService } from "./experiment-tracking.service";
import { ObjectiveFunctionService } from "./objective-function.service";
import { PolicyCandidateRegistryService } from "./policy-candidate-registry.service";
import { PolicyPromotionGateService } from "./policy-promotion-gate.service";
import { ResearchLabConfigService } from "./research-lab-config.service";
import { RobustnessCheckService } from "./robustness-check.service";
import { SegmentScorecardService } from "./segment-scorecard.service";
import { TrialPruningService } from "./trial-pruning.service";
import { TuningEngineService } from "./tuning-engine.service";
import { InternalRuntimeSecurityService } from "../security-hardening/internal-runtime-security.service";

const RESEARCH_QUEUE = "research-lab";
const RESEARCH_STAGES = [
  "freezeDataset",
  "generateConfigSet",
  "runTrial",
  "simulateTrial",
  "aggregateTrialMetrics",
  "runRobustnessChecks",
  "registerPolicyCandidate",
  "evaluatePromotionGate",
  "exportArtifacts"
] as const;

type ResearchStage = (typeof RESEARCH_STAGES)[number];

type ResearchFlowInput = {
  projectId: string;
  experimentId: string;
  rangeStart: Date;
  rangeEnd: Date;
  sport: string;
  objectiveMetric: string;
  secondaryMetrics?: string[];
  datasetHashes: Record<string, unknown>;
  seed: number;
  searchType?: TuningSearchType;
  maxTrials?: number;
  actor?: string;
  strategyConfig?: Record<string, unknown>;
  marketScope?: string[];
  horizonScope?: string[];
  leagueScope?: string[];
  notes?: string;
  tags?: string[];
};

type StagePayload = {
  stage: ResearchStage;
  runId: string;
  authority: "internal";
  serviceIdentityId: string;
  runKey: string;
  dedupKey: string;
  projectId: string;
  experimentId: string;
  rangeStart: string;
  rangeEnd: string;
  sport: string;
  objectiveMetric: string;
  secondaryMetrics: string[];
  datasetHashes: Record<string, unknown>;
  seed: number;
  searchType: TuningSearchType;
  maxTrials: number;
  actor: string;
  strategyConfig: Record<string, unknown>;
  marketScope: string[];
  horizonScope: string[];
  leagueScope: string[];
  notes: string | null;
  tags: string[];
};

@Injectable()
export class ResearchLabOrchestrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ResearchLabOrchestrationService.name);
  private readonly isWorker = this.resolveWorkerMode();
  private flowProducer: FlowProducer | null = null;
  private worker: Worker | null = null;

  constructor(
    @InjectQueue(RESEARCH_QUEUE) private readonly researchQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly configService: ResearchLabConfigService,
    private readonly trackingService: ExperimentTrackingService,
    private readonly tuningEngineService: TuningEngineService,
    private readonly objectiveFunctionService: ObjectiveFunctionService,
    private readonly trialPruningService: TrialPruningService,
    private readonly robustnessCheckService: RobustnessCheckService,
    private readonly segmentScorecardService: SegmentScorecardService,
    private readonly candidateRegistry: PolicyCandidateRegistryService,
    private readonly promotionGateService: PolicyPromotionGateService,
    private readonly internalRuntimeSecurityService: InternalRuntimeSecurityService
  ) {}

  queueName() {
    return RESEARCH_QUEUE;
  }

  stages() {
    return [...RESEARCH_STAGES];
  }

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

  private normalizeSearchType(value: TuningSearchType | undefined) {
    if (value === TuningSearchType.GRID || value === TuningSearchType.OPTUNA_COMPAT || value === TuningSearchType.RANDOM) {
      return value;
    }
    return TuningSearchType.RANDOM;
  }

  private dedupKey(input: ResearchFlowInput) {
    return stableHash({
      projectId: input.projectId,
      experimentId: input.experimentId,
      rangeStart: input.rangeStart.toISOString(),
      rangeEnd: input.rangeEnd.toISOString(),
      sport: input.sport.trim().toLowerCase(),
      objectiveMetric: input.objectiveMetric,
      datasetHashes: input.datasetHashes,
      seed: input.seed,
      searchType: this.normalizeSearchType(input.searchType),
      maxTrials: Math.max(1, Math.min(500, Math.floor(input.maxTrials ?? 60)))
    });
  }

  private resolveServiceIdentityId(value: unknown) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    return this.internalRuntimeSecurityService.resolveServiceIdentity("research-lab");
  }

  private toRuntimePayload(stage: ResearchStage, payload: Partial<StagePayload>) {
    const dedupKey = typeof payload.dedupKey === "string" && payload.dedupKey.trim().length > 0 ? payload.dedupKey : "research:runtime";
    const runId = typeof payload.runId === "string" && payload.runId.trim().length > 0 ? payload.runId : dedupKey;
    return {
      ...payload,
      stage,
      dedupKey,
      runId,
      authority: typeof payload.authority === "string" ? payload.authority : "internal",
      serviceIdentityId: this.resolveServiceIdentityId(payload.serviceIdentityId)
    } as Record<string, unknown>;
  }

  private async validateStagePayload(
    stage: ResearchStage,
    payload: Partial<StagePayload>,
    mode: "enqueue" | "process"
  ) {
    const runtimePayload = this.toRuntimePayload(stage, payload);
    const validated = await this.internalRuntimeSecurityService.validateQueuePayload({
      queueName: RESEARCH_QUEUE,
      jobName: stage,
      payload: runtimePayload,
      mode,
      serviceIdentityId:
        typeof runtimePayload.serviceIdentityId === "string" ? runtimePayload.serviceIdentityId : undefined
    });
    return validated.payload as unknown as StagePayload;
  }

  private async processQueuedStage(stage: ResearchStage, payload: Partial<StagePayload>) {
    const validated = await this.validateStagePayload(stage, payload, "process");
    await this.processStage(stage, validated);
  }

  private async runSerializable<T>(handler: () => Promise<T>, attempts = 5): Promise<T> {
    let tryCount = 0;
    while (tryCount < attempts) {
      tryCount += 1;
      try {
        return await handler();
      } catch (error) {
        const isSerialization = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!isSerialization || tryCount >= attempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 20 * tryCount));
      }
    }
    throw new Error("research_serializable_retry_exhausted");
  }

  private async withStageLock<T>(
    tx: Prisma.TransactionClient,
    dedupKey: string,
    stage: ResearchStage,
    handler: () => Promise<T>
  ) {
    const lock = `${dedupKey}:${stage}`;
    const left = lock.slice(0, Math.ceil(lock.length / 2));
    const right = lock.slice(Math.ceil(lock.length / 2));
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${left}), hashtext(${right}))
    `;
    return handler();
  }

  async enqueueResearchFlow(input: ResearchFlowInput) {
    const settings = await this.configService.getSettings();
    if (!settings.researchLabEnabled) {
      return { queued: false, reason: "research_lab_disabled" as const };
    }

    const run = await this.trackingService.createOrUpdateRun({
      projectId: input.projectId,
      experimentId: input.experimentId,
      rangeStart: input.rangeStart,
      rangeEnd: input.rangeEnd,
      sport: input.sport,
      objectiveMetric: input.objectiveMetric,
      secondaryMetrics: input.secondaryMetrics ?? [],
      seed: input.seed,
      datasetHashes: input.datasetHashes,
      strategyConfigSetId: null,
      strategyConfigVersionId: null,
      searchSpaceId: null,
      marketScope: { values: input.marketScope ?? [] },
      horizonScope: { values: input.horizonScope ?? [] },
      leagueScope: { values: input.leagueScope ?? [] },
      notes: input.notes ?? null,
      tags: input.tags ?? []
    });

    const dedupKey = this.dedupKey(input);
    const payload: StagePayload = {
      stage: "freezeDataset",
      runId: run.id,
      authority: "internal",
      serviceIdentityId: this.internalRuntimeSecurityService.resolveServiceIdentity("research-lab"),
      runKey: run.runKey,
      dedupKey,
      projectId: input.projectId,
      experimentId: input.experimentId,
      rangeStart: input.rangeStart.toISOString(),
      rangeEnd: input.rangeEnd.toISOString(),
      sport: input.sport.trim().toLowerCase(),
      objectiveMetric: input.objectiveMetric,
      secondaryMetrics: input.secondaryMetrics ?? [],
      datasetHashes: input.datasetHashes,
      seed: input.seed,
      searchType: this.normalizeSearchType(input.searchType),
      maxTrials: Math.max(1, Math.min(500, Math.floor(input.maxTrials ?? 60))),
      actor: input.actor ?? "system",
      strategyConfig: input.strategyConfig ?? {},
      marketScope: input.marketScope ?? [],
      horizonScope: input.horizonScope ?? [],
      leagueScope: input.leagueScope ?? [],
      notes: input.notes ?? null,
      tags: input.tags ?? []
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

    const createNode = async (stage: ResearchStage, children?: Array<Record<string, unknown>>) => {
      const validated = await this.validateStagePayload(stage, payload, "enqueue");
      return {
        name: stage,
        queueName: RESEARCH_QUEUE,
        data: {
          ...validated,
          stage
        },
        opts: {
          ...sharedOpts,
          jobId: `${payload.dedupKey}:${stage}`
        },
        ...(children && children.length > 0 ? { children } : {})
      };
    };

    let root = await createNode(RESEARCH_STAGES[0]);
    for (let index = 1; index < RESEARCH_STAGES.length; index += 1) {
      root = await createNode(RESEARCH_STAGES[index], [root]);
    }

    await this.flow().add(root as any);
    return {
      queued: true,
      runId: run.id,
      dedupKey
    };
  }

  private normalizeMetrics(metrics: Record<string, unknown>) {
    const toNumber = (key: string, fallback = 0) => {
      const value = metrics[key];
      return typeof value === "number" && Number.isFinite(value) ? value : fallback;
    };
    return {
      turnover: toNumber("turnover"),
      roi: toNumber("roi"),
      yield: toNumber("yield"),
      hitRate: toNumber("hitRate"),
      logLoss: toNumber("logLoss"),
      brierScore: toNumber("brierScore"),
      maxDrawdown: toNumber("maxDrawdown"),
      riskOfRuin: toNumber("riskOfRuin"),
      abstainRate: toNumber("abstainRate"),
      publishRate: toNumber("publishRate"),
      fallbackRate: toNumber("fallbackRate"),
      breachRate: toNumber("breachRate")
    };
  }

  private simulateMetrics(payload: StagePayload, trialKey: string, trialNumber: number) {
    const token = stableHash({
      dedupKey: payload.dedupKey,
      trialKey,
      trialNumber,
      seed: payload.seed
    });
    const sample = (offset: number) => parseInt(token.slice(offset, offset + 6), 16) / 0xffffff;
    const turnover = Number((180 + sample(0) * 420).toFixed(6));
    const roi = Number((-0.04 + sample(6) * 0.22).toFixed(6));
    const yieldValue = Number((-0.03 + sample(12) * 0.18).toFixed(6));
    const hitRate = Number((0.35 + sample(18) * 0.4).toFixed(6));
    const logLoss = Number((0.45 + sample(24) * 0.45).toFixed(6));
    const brierScore = Number((0.14 + sample(30) * 0.26).toFixed(6));
    const maxDrawdown = Number((0.03 + sample(36) * 0.28).toFixed(6));
    const riskOfRuin = Number((0.01 + sample(42) * 0.18).toFixed(6));
    const abstainRate = Number((0.1 + sample(48) * 0.5).toFixed(6));
    const publishRate = Number((1 - abstainRate).toFixed(6));
    const fallbackRate = Number((sample(2) * 0.12).toFixed(6));
    const breachRate = Number((sample(8) * 0.09).toFixed(6));

    return {
      turnover,
      roi,
      yield: yieldValue,
      hitRate,
      logLoss,
      brierScore,
      maxDrawdown,
      riskOfRuin,
      abstainRate,
      publishRate,
      fallbackRate,
      breachRate
    };
  }

  private async processFreezeDataset(payload: StagePayload) {
    await this.prisma.researchRun.update({
      where: { id: payload.runId },
      data: {
        status: ResearchRunStatus.running,
        metricsJson: {
          stage: "freezeDataset",
          frozenAt: new Date().toISOString(),
          datasetHashes: payload.datasetHashes
        } as Prisma.InputJsonValue
      }
    });
  }

  private async processGenerateConfigSet(payload: StagePayload) {
    await this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, payload.dedupKey, "generateConfigSet", async () => {
            const configSet = await tx.strategyConfigSet.upsert({
              where: {
                experimentId_key: {
                  experimentId: payload.experimentId,
                  key: "default"
                }
              },
              update: {
                name: "Default Strategy Config Set",
                description: "Offline research strategy tuning set",
                scopeJson: {
                  sport: payload.sport,
                  leagues: payload.leagueScope,
                  markets: payload.marketScope,
                  horizons: payload.horizonScope
                } as Prisma.InputJsonValue,
                isActive: true
              },
              create: {
                experimentId: payload.experimentId,
                key: "default",
                name: "Default Strategy Config Set",
                description: "Offline research strategy tuning set",
                scopeJson: {
                  sport: payload.sport,
                  leagues: payload.leagueScope,
                  markets: payload.marketScope,
                  horizons: payload.horizonScope
                } as Prisma.InputJsonValue,
                isActive: true
              }
            });

            const latest = await tx.strategyConfigVersion.findFirst({
              where: { configSetId: configSet.id },
              orderBy: { version: "desc" }
            });
            const targetHash = stableHash(payload.strategyConfig);
            const version = latest && latest.configHash === targetHash
              ? latest
              : await tx.strategyConfigVersion.create({
                  data: {
                    configSetId: configSet.id,
                    version: (latest?.version ?? 0) + 1,
                    label: `auto_${new Date().toISOString().slice(0, 19)}`,
                    configHash: targetHash,
                    configJson: payload.strategyConfig as Prisma.InputJsonValue,
                    immutable: true
                  }
                });

            await tx.strategyConfigSet.update({
              where: { id: configSet.id },
              data: { currentVersionId: version.id }
            });

            const searchSpace = await tx.tuningSearchSpace.upsert({
              where: {
                experimentId_key_version: {
                  experimentId: payload.experimentId,
                  key: payload.searchType.toLowerCase(),
                  version: 1
                }
              },
              update: {
                searchType: payload.searchType,
                searchSpaceJson: this.defaultSearchSpace(payload.searchType),
                constraintsJson: this.defaultConstraints(),
                seed: payload.seed,
                isActive: true
              },
              create: {
                experimentId: payload.experimentId,
                key: payload.searchType.toLowerCase(),
                version: 1,
                searchType: payload.searchType,
                searchSpaceJson: this.defaultSearchSpace(payload.searchType),
                constraintsJson: this.defaultConstraints(),
                seed: payload.seed,
                isActive: true
              }
            });

            await tx.researchRun.update({
              where: { id: payload.runId },
              data: {
                strategyConfigSetId: configSet.id,
                strategyConfigVersionId: version.id,
                searchSpaceId: searchSpace.id
              }
            });
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  private defaultSearchSpace(searchType: TuningSearchType) {
    if (searchType === TuningSearchType.GRID) {
      return {
        type: TuningSearchType.GRID,
        maxTrials: 108,
        grid: {
          min_confidence: [0.52, 0.55, 0.58, 0.62],
          min_publish_score: [0.54, 0.58, 0.62],
          min_edge: [0, 0.005, 0.01],
          kelly_fraction: [0.15, 0.2, 0.25]
        }
      } as Prisma.InputJsonValue;
    }
    return {
      type: searchType,
      maxTrials: 80,
      random: {
        min_confidence: { min: 0.5, max: 0.68, step: 0.01 },
        min_publish_score: { min: 0.5, max: 0.72, step: 0.01 },
        min_edge: { min: -0.005, max: 0.03, step: 0.001 },
        volatility_cap: { min: 0.15, max: 0.5, step: 0.01 },
        max_picks_per_match: { min: 1, max: 4, step: 1 },
        kelly_fraction: { min: 0.08, max: 0.3, step: 0.01 },
        hard_cap_per_bet: { min: 0.005, max: 0.04, step: 0.001 }
      }
    } as Prisma.InputJsonValue;
  }

  private defaultConstraints() {
    return {
      constraints: [
        { metric: "maxDrawdown", op: "lte", value: 0.32 },
        { metric: "abstainRate", op: "lte", value: 0.65 },
        { metric: "publishRate", op: "gte", value: 0.2 }
      ]
    } as Prisma.InputJsonValue;
  }

  private async processRunTrial(payload: StagePayload) {
    const run = await this.prisma.researchRun.findUnique({
      where: { id: payload.runId },
      select: {
        id: true,
        searchSpaceId: true,
        strategyConfigVersionId: true
      }
    });
    if (!run?.searchSpaceId) {
      return;
    }
    const searchSpace = await this.prisma.tuningSearchSpace.findUnique({
      where: { id: run.searchSpaceId }
    });
    if (!searchSpace) {
      return;
    }
    const def = (searchSpace.searchSpaceJson as Record<string, unknown>) ?? {};
    const plans = this.tuningEngineService.buildTrialPlan({
      experimentId: payload.experimentId,
      runId: payload.runId,
      baseSeed: payload.seed,
      searchSpace: {
        type: searchSpace.searchType,
        grid: (def.grid as Record<string, number[]>) ?? {},
        random: (def.random as Record<string, { min: number; max: number; step?: number }>) ?? {},
        maxTrials: Math.min(payload.maxTrials, Number(def.maxTrials ?? payload.maxTrials))
      }
    });

    const toCreate = plans.slice(0, payload.maxTrials);
    for (const plan of toCreate) {
      await this.prisma.tuningTrial.upsert({
        where: { trialKey: plan.trialKey },
        update: {
          status: ResearchRunStatus.queued,
          configHash: plan.configHash,
          configJson: plan.config as Prisma.InputJsonValue,
          strategyConfigVersionId: run.strategyConfigVersionId ?? null,
          seed: plan.seed
        },
        create: {
          researchRunId: payload.runId,
          strategyConfigVersionId: run.strategyConfigVersionId ?? null,
          trialNumber: plan.trialNumber,
          trialKey: plan.trialKey,
          status: ResearchRunStatus.queued,
          configHash: plan.configHash,
          configJson: plan.config as Prisma.InputJsonValue,
          seed: plan.seed
        }
      });
    }
  }

  private async processSimulateTrial(payload: StagePayload) {
    const settings = await this.configService.getSettings();
    const trials = await this.prisma.tuningTrial.findMany({
      where: {
        researchRunId: payload.runId
      },
      orderBy: { trialNumber: "asc" },
      take: payload.maxTrials
    });

    for (const trial of trials) {
      const metrics = this.simulateMetrics(payload, trial.trialKey, trial.trialNumber);
      const score = this.objectiveFunctionService.score(metrics, {
        primary: StrategyObjective.ROI,
        secondary: ["yield", "hitRate", "publishRate"],
        weights: {
          yield: 0.3,
          hitRate: 0.2,
          publishRate: 0.1
        },
        constraints: [
          { metric: "maxDrawdown", op: "lte", value: 0.32 },
          { metric: "riskOfRuin", op: "lte", value: 0.2 },
          { metric: "publishRate", op: "gte", value: 0.2 }
        ]
      });
      const combinedMetrics = {
        ...metrics,
        objectiveScore: score.score,
        objectivePassedConstraints: score.passedConstraints,
        objectiveConstraintFailures: score.constraintFailures
      };
      await this.prisma.tuningTrial.update({
        where: { id: trial.id },
        data: {
          status: ResearchRunStatus.succeeded,
          metricsJson: combinedMetrics as Prisma.InputJsonValue,
          startedAt: trial.startedAt ?? new Date(),
          completedAt: new Date()
        }
      });

      const metricRows = Object.entries(combinedMetrics)
        .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
        .map(([metricKey, metricValue]) => ({
          tuningTrialId: trial.id,
          metricKey,
          metricValue: Number(metricValue),
          isPrimary: metricKey === payload.objectiveMetric
        }));
      if (metricRows.length > 0) {
        await this.prisma.tuningTrialMetric.createMany({
          data: metricRows,
          skipDuplicates: true
        });
      }

      if (settings.trialPruningEnabled) {
        const decision = this.trialPruningService.decide({
          drawdown: metrics.maxDrawdown,
          riskOfRuin: metrics.riskOfRuin,
          roi: metrics.roi,
          logLoss: metrics.logLoss,
          sampleSize: Math.max(30, Math.floor(metrics.turnover)),
          config: {
            maxDrawdown: 0.32,
            maxRiskOfRuin: 0.2,
            minRoiFloor: -0.03,
            maxLogLoss: 0.9,
            minSampleForDecision: 60
          }
        });
        if (decision.pruned) {
          await this.trialPruningService.persistDecision(this.prisma, {
            trialId: trial.id,
            decision,
            metrics: combinedMetrics
          });
        }
      }
    }
  }

  private async processAggregateTrialMetrics(payload: StagePayload) {
    const trials = await this.prisma.tuningTrial.findMany({
      where: {
        researchRunId: payload.runId
      },
      select: {
        id: true,
        trialNumber: true,
        pruned: true,
        pruneReason: true,
        metricsJson: true
      }
    });
    if (trials.length === 0) {
      return;
    }
    const scored = trials.map((trial) => {
      const metrics = this.normalizeMetrics((trial.metricsJson as Record<string, unknown>) ?? {});
      const objectiveScore = typeof (trial.metricsJson as Record<string, unknown>)?.objectiveScore === "number"
        ? Number((trial.metricsJson as Record<string, unknown>).objectiveScore)
        : metrics.roi;
      return {
        trialId: trial.id,
        trialNumber: trial.trialNumber,
        objectiveScore,
        pruned: trial.pruned,
        pruneReason: trial.pruneReason,
        metrics
      };
    });
    const best = [...scored]
      .filter((row) => !row.pruned)
      .sort((left, right) => right.objectiveScore - left.objectiveScore)[0] ?? scored.sort((l, r) => r.objectiveScore - l.objectiveScore)[0];

    const scorecards = this.segmentScorecardService.buildScorecards(
      scored.map((row) => ({
        segmentType: "trial",
        segmentKey: `trial_${row.trialNumber}`,
        turnover: row.metrics.turnover,
        roi: row.metrics.roi,
        yield: row.metrics.yield,
        hitRate: row.metrics.hitRate,
        logLoss: row.metrics.logLoss,
        brierScore: row.metrics.brierScore,
        publishRate: row.metrics.publishRate,
        abstainRate: row.metrics.abstainRate,
        averageStakeFraction: row.metrics.publishRate > 0 ? 0.02 : 0,
        maxDrawdown: row.metrics.maxDrawdown,
        longestLosingStreak: Math.max(1, Math.round(row.metrics.maxDrawdown * 40)),
        fallbackRate: row.metrics.fallbackRate,
        limitBreachRate: row.metrics.breachRate
      }))
    );

    await this.prisma.$transaction(async (tx) => {
      await tx.segmentScorecard.deleteMany({ where: { researchRunId: payload.runId } });
      if (scorecards.length > 0) {
        await tx.segmentScorecard.createMany({
          data: scorecards.map((scorecard) => ({
            researchRunId: payload.runId,
            segmentType: scorecard.segmentType,
            segmentKey: scorecard.segmentKey,
            metricsJson: scorecard.metrics as Prisma.InputJsonValue
          }))
        });
      }

      await tx.researchRun.update({
        where: { id: payload.runId },
        data: {
          metricsJson: {
            stage: "aggregateTrialMetrics",
            bestTrialId: best.trialId,
            bestObjectiveScore: best.objectiveScore,
            totalTrials: scored.length,
            prunedTrials: scored.filter((trial) => trial.pruned).length
          } as Prisma.InputJsonValue
        }
      });
    });
  }

  private async processRunRobustnessChecks(payload: StagePayload) {
    const scoredTrials = await this.prisma.tuningTrial.findMany({
      where: { researchRunId: payload.runId },
      select: {
        metricsJson: true
      }
    });
    const metricsRows = scoredTrials
      .map((row) => this.normalizeMetrics((row.metricsJson as Record<string, unknown>) ?? {}))
      .filter((row) => row.turnover > 0);
    const topTwo = [...metricsRows].sort((a, b) => b.roi - a.roi).slice(0, 2);
    const overfitGap = topTwo.length >= 2 ? Math.abs(topTwo[0].roi - topTwo[1].roi) : 0;
    const summary = this.robustnessCheckService.evaluate({
      rollingWindows: metricsRows.slice(0, 10),
      seasonWindows: metricsRows.slice(0, 6),
      leagueWindows: metricsRows.slice(0, 8),
      marketWindows: metricsRows.slice(0, 8),
      horizonWindows: metricsRows.slice(0, 8),
      oddsCoverageDropDelta: 0.08,
      lineupCoverageDropDelta: 0.11,
      eventCoverageDropDelta: 0.13,
      parameterPerturbationDelta: 0.09,
      overfitGap
    });

    const run = await this.prisma.robustnessTestRun.create({
      data: {
        researchRunId: payload.runId,
        status: summary.unstable ? ResearchRunStatus.failed : ResearchRunStatus.succeeded,
        robustnessScore: summary.score,
        summaryJson: {
          reasons: summary.reasons
        } as Prisma.InputJsonValue,
        flagsJson: summary.flags as Prisma.InputJsonValue,
        startedAt: new Date(),
        completedAt: new Date()
      }
    });

    if (summary.checks.length > 0) {
      await this.prisma.robustnessTestResult.createMany({
        data: summary.checks.map((check) => ({
          robustnessTestRunId: run.id,
          checkName: check.checkName,
          passed: check.passed,
          score: check.score,
          detailsJson: check.details as Prisma.InputJsonValue
        }))
      });
    }
  }

  private async processRegisterPolicyCandidate(payload: StagePayload) {
    const run = await this.prisma.researchRun.findUnique({
      where: { id: payload.runId },
      select: {
        id: true,
        projectId: true,
        experimentId: true,
        strategyConfigVersionId: true,
        searchSpaceId: true,
        metricsJson: true
      }
    });
    if (!run) {
      return;
    }
    const bestTrial = await this.prisma.tuningTrial.findFirst({
      where: {
        researchRunId: run.id,
        pruned: false
      },
      orderBy: [{ metricsJson: "desc" }]
    });
    const robustnessRun = await this.prisma.robustnessTestRun.findFirst({
      where: { researchRunId: run.id },
      orderBy: { createdAt: "desc" }
    });

    const candidateKey = stableHash({
      runId: run.id,
      bestTrialId: bestTrial?.id ?? null,
      strategyConfigVersionId: run.strategyConfigVersionId ?? null
    });

    await this.candidateRegistry.registerCandidate({
      projectId: run.projectId,
      experimentId: run.experimentId,
      researchRunId: run.id,
      bestTrialId: bestTrial?.id ?? null,
      strategyConfigVersionId: run.strategyConfigVersionId ?? null,
      searchSpaceId: run.searchSpaceId ?? null,
      robustnessTestRunId: robustnessRun?.id ?? null,
      key: candidateKey,
      summary: (run.metricsJson as Record<string, unknown>) ?? {},
      objectiveDefinition: {
        primary: payload.objectiveMetric,
        secondary: payload.secondaryMetrics
      },
      datasetHashes: payload.datasetHashes
    });
  }

  private async processEvaluatePromotionGate(payload: StagePayload) {
    const settings = await this.configService.getSettings();
    if (!settings.policyCandidateRegistryEnabled) {
      return;
    }
    const candidate = await this.prisma.policyCandidate.findFirst({
      where: { researchRunId: payload.runId },
      orderBy: { createdAt: "desc" }
    });
    if (!candidate) {
      return;
    }
    const request = await this.candidateRegistry.createPromotionRequest({
      candidateId: candidate.id,
      researchRunId: payload.runId,
      requestedBy: payload.actor,
      reason: "auto_research_gate",
      evidence: {
        dedupKey: payload.dedupKey,
        runId: payload.runId
      }
    });
    const robustness = await this.prisma.robustnessTestRun.findFirst({
      where: { id: candidate.robustnessTestRunId ?? undefined }
    });
    const trial = candidate.bestTrialId
      ? await this.prisma.tuningTrial.findUnique({ where: { id: candidate.bestTrialId } })
      : null;
    const metrics = ((trial?.metricsJson as Record<string, unknown>) ?? {}) as Record<string, unknown>;

    await this.promotionGateService.evaluateAndPersist({
      requestId: request.id,
      candidateId: candidate.id,
      actor: payload.actor,
      allowCanary: settings.policyCanaryPromotionEnabled,
      evaluation: {
        sampleSize: Math.max(0, Math.floor(Number(metrics.turnover ?? 0))),
        minimumSampleSize: 160,
        robustnessScore: robustness?.robustnessScore ?? 0,
        minimumRobustnessScore: 0.58,
        hasOverfitFlag: Array.isArray((robustness?.flagsJson as unknown[] | null) ?? [])
          ? ((robustness?.flagsJson as unknown[]).includes("top_trial_overfit_detection"))
          : false,
        hasSegmentFailure: (Number(metrics.breachRate ?? 0) > 0.08) || (Number(metrics.publishRate ?? 0) < 0.18),
        auditComplete: true
      }
    });
  }

  private async processExportArtifacts(payload: StagePayload) {
    await this.trackingService.addRunArtifact({
      runId: payload.runId,
      artifactType: "summary_json",
      artifactKey: `run_summary_${payload.dedupKey.slice(0, 12)}`,
      artifactUri: null,
      metadata: {
        dedupKey: payload.dedupKey,
        stage: "exportArtifacts",
        generatedAt: new Date().toISOString()
      }
    });
    await this.trackingService.markRunCompleted(payload.runId, ResearchRunStatus.succeeded, {
      stage: "completed",
      dedupKey: payload.dedupKey
    });
  }

  private async processStage(stage: ResearchStage, payload: StagePayload) {
    if (stage === "freezeDataset") {
      await this.processFreezeDataset(payload);
      return;
    }
    if (stage === "generateConfigSet") {
      await this.processGenerateConfigSet(payload);
      return;
    }
    if (stage === "runTrial") {
      await this.processRunTrial(payload);
      return;
    }
    if (stage === "simulateTrial") {
      await this.processSimulateTrial(payload);
      return;
    }
    if (stage === "aggregateTrialMetrics") {
      await this.processAggregateTrialMetrics(payload);
      return;
    }
    if (stage === "runRobustnessChecks") {
      await this.processRunRobustnessChecks(payload);
      return;
    }
    if (stage === "registerPolicyCandidate") {
      await this.processRegisterPolicyCandidate(payload);
      return;
    }
    if (stage === "evaluatePromotionGate") {
      await this.processEvaluatePromotionGate(payload);
      return;
    }
    await this.processExportArtifacts(payload);
  }

  async startWorker() {
    if (this.worker) {
      return;
    }
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    const concurrency = Math.max(1, Math.min(2, Number(process.env.RESEARCH_WORKER_CONCURRENCY ?? 1) || 1));

    this.worker = new Worker(
      RESEARCH_QUEUE,
      async (job) => {
        const stage = job.name as ResearchStage;
        if (!RESEARCH_STAGES.includes(stage)) {
          return;
        }
        await this.processQueuedStage(stage, (job.data ?? {}) as Partial<StagePayload>);
      },
      {
        connection: { url },
        concurrency
      }
    );

    this.worker.on("completed", (job) => {
      this.logger.log(
        JSON.stringify({
          event: "research_stage_completed",
          stage: job.name,
          runId: typeof job.data?.runId === "string" ? job.data.runId : null,
          dedupKey: typeof job.data?.dedupKey === "string" ? job.data.dedupKey : null
        })
      );
    });

    this.worker.on("failed", async (job, error) => {
      const payload = (job?.data ?? {}) as Partial<StagePayload>;
      this.logger.error(
        `research stage failed: ${job?.name ?? "unknown"}`,
        error instanceof Error ? error.stack : undefined
      );
      if (payload.runId) {
        await this.trackingService
          .markRunCompleted(payload.runId, ResearchRunStatus.failed, {
            failedStage: job?.name ?? null,
            message: error instanceof Error ? error.message : "unknown_error"
          })
          .catch(() => undefined);
      }
    });
  }
}
