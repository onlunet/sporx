import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { BankrollProfileKey, Prisma, PublishDecisionStatus, StakeDecisionStatus } from "@prisma/client";
import { FlowProducer, Queue, Worker } from "bullmq";
import { CacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import {
  clamp,
  normalizeLineKey,
  normalizeSelectionToken,
  resolveMarketFamily,
  round,
  toCalendarKey
} from "./bankroll-market-family.util";
import { BankrollConfigService } from "./bankroll-config.service";
import { StakeCandidateBuilderService, StakeCandidateBuildInput } from "./stake-candidate-builder.service";
import { StakeSizingService } from "./stake-sizing.service";
import { ExposureCheckService } from "./exposure-check.service";
import { CorrelationCheckService } from "./correlation-check.service";
import { TicketConstructionService } from "./ticket-construction.service";
import { PaperExecutionService } from "./paper-execution.service";
import { SettlementService } from "./settlement.service";
import { BankrollAccountingService } from "./bankroll-accounting.service";
import { SimulationService } from "./simulation.service";
import { RoiGovernanceService } from "./roi-governance.service";

const BANKROLL_QUEUE = "bankroll";
const BANKROLL_PIPELINE_STAGES = [
  "stakeCandidateBuild",
  "stakeSizing",
  "exposureCheck",
  "correlationCheck",
  "ticketConstruction",
  "portfolioDecision",
  "paperExecution",
  "settlement",
  "bankrollAccounting",
  "simulationAnalytics",
  "roiGovernance"
] as const;

type BankrollStage = (typeof BANKROLL_PIPELINE_STAGES)[number];

export type PublishedSelectionInput = {
  sportCode: string;
  matchId: string;
  leagueId: string | null;
  market: string;
  line: number | null;
  horizon: string;
  selection: string;
  predictionRunId: string;
  modelVersionId: string | null;
  calibrationVersionId: string | null;
  publishedPredictionId: string;
  publishDecisionId: string;
  publishDecisionStatus: PublishDecisionStatus;
  calibratedProbability: number;
  fairOdds: number | null;
  offeredOdds: number | null;
  edge: number | null;
  confidence: number;
  publishScore: number;
  freshnessScore: number | null;
  coverageFlags: Record<string, unknown>;
  volatilityScore: number | null;
  providerDisagreement: number | null;
};

type BankrollJobPayload = {
  stage: BankrollStage;
  dedupBaseKey: string;
  publishedSelection: PublishedSelectionInput;
  accountId: string;
  policyVersionId: string;
  profileKey: BankrollProfileKey;
};

@Injectable()
export class BankrollOrchestrationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BankrollOrchestrationService.name);
  private readonly isWorker = this.resolveWorkerMode();
  private flowProducer: FlowProducer | null = null;
  private worker: Worker | null = null;
  private schedulersInstalled = false;

  constructor(
    @InjectQueue(BANKROLL_QUEUE) private readonly bankrollQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly configService: BankrollConfigService,
    private readonly stakeCandidateBuilder: StakeCandidateBuilderService,
    private readonly stakeSizingService: StakeSizingService,
    private readonly exposureCheckService: ExposureCheckService,
    private readonly correlationCheckService: CorrelationCheckService,
    private readonly ticketConstructionService: TicketConstructionService,
    private readonly paperExecutionService: PaperExecutionService,
    private readonly settlementService: SettlementService,
    private readonly accountingService: BankrollAccountingService,
    private readonly simulationService: SimulationService,
    private readonly governanceService: RoiGovernanceService
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

  private advisoryKey(dedupBaseKey: string, stage: string) {
    return `${dedupBaseKey}:${stage}`;
  }

  private async runSerializable<T>(handler: () => Promise<T>, attempts = 5): Promise<T> {
    let count = 0;
    while (count < attempts) {
      count += 1;
      try {
        return await handler();
      } catch (error) {
        const isSerializable = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
        if (!isSerializable || count >= attempts) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, Math.min(120, count * 20)));
      }
    }
    throw new Error("bankroll_serializable_retry_exhausted");
  }

  private async withStageLock<T>(tx: Prisma.TransactionClient, lockKey: string, handler: () => Promise<T>) {
    const left = lockKey.slice(0, Math.ceil(lockKey.length / 2));
    const right = lockKey.slice(Math.ceil(lockKey.length / 2));
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtext(${left}), hashtext(${right}))
    `;
    return handler();
  }

  private buildBaseDedup(selection: PublishedSelectionInput) {
    return [
      selection.sportCode.trim().toLowerCase(),
      selection.matchId,
      selection.market.trim().toLowerCase(),
      normalizeLineKey(selection.line),
      selection.horizon.trim().toUpperCase(),
      normalizeSelectionToken(selection.selection),
      selection.publishedPredictionId
    ].join(":");
  }

  private async stageStakeCandidateBuild(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "stakeCandidateBuild"), async () => {
            const selection = payload.publishedSelection;
            const input: StakeCandidateBuildInput = {
              sportCode: selection.sportCode,
              matchId: selection.matchId,
              market: selection.market,
              line: selection.line,
              horizon: selection.horizon,
              selection: selection.selection,
              publishedPredictionId: selection.publishedPredictionId,
              predictionRunId: selection.predictionRunId,
              modelVersionId: selection.modelVersionId,
              calibrationVersionId: selection.calibrationVersionId,
              bankrollAccountId: payload.accountId,
              profileKey: payload.profileKey,
              stakingPolicyVersionId: payload.policyVersionId,
              calibratedProbability: selection.calibratedProbability,
              fairOdds: selection.fairOdds,
              offeredOdds: selection.offeredOdds,
              edge: selection.edge,
              confidence: selection.confidence,
              publishScore: selection.publishScore,
              freshnessScore: selection.freshnessScore,
              coverageFlags: selection.coverageFlags,
              volatilityScore: selection.volatilityScore,
              providerDisagreement: selection.providerDisagreement
            };

            const candidate = await this.stakeCandidateBuilder.upsert(tx, input);

            await tx.stakeRecommendation.upsert({
              where: {
                stakeCandidateId: candidate.id
              },
              update: {
                bankrollAccountId: payload.accountId,
                profileKey: payload.profileKey,
                stakingPolicyVersionId: payload.policyVersionId,
                decisionStatus: StakeDecisionStatus.CREATED,
                reasonsJson: [] as Prisma.InputJsonValue,
                recommendedFraction: null,
                recommendedStake: null,
                clippedStake: null
              },
              create: {
                stakeCandidateId: candidate.id,
                bankrollAccountId: payload.accountId,
                profileKey: payload.profileKey,
                stakingPolicyVersionId: payload.policyVersionId,
                decisionStatus: StakeDecisionStatus.CREATED,
                reasonsJson: [] as Prisma.InputJsonValue
              }
            });

            return candidate;
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  private async stageStakeSizing(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "stakeSizing"), async () => {
            const candidate = await tx.stakeCandidate.findUnique({
              where: {
                dedupKey: payload.dedupBaseKey
              }
            });

            if (!candidate) {
              return null;
            }

            const account = await tx.bankrollAccount.findUnique({
              where: { id: payload.accountId }
            });
            if (!account) {
              throw new Error("bankroll_account_not_found");
            }

            const { profileConfig } = await this.configService.resolvePolicyAndProfile(payload.accountId, payload.profileKey);
            const sizing = this.stakeSizingService.score({
              profile: payload.profileKey,
              bankrollAvailable: account.availableBalance,
              calibratedProbability: candidate.calibratedProbability,
              fairOdds: candidate.fairOdds,
              offeredOdds: candidate.offeredOdds,
              edge: candidate.edge,
              confidence: candidate.confidence,
              publishScore: candidate.publishScore,
              config: profileConfig
            });

            await tx.stakeCandidate.update({
              where: { id: candidate.id },
              data: {
                recommendedFraction: round(sizing.recommendedFraction, 6),
                recommendedStake: round(sizing.recommendedStake, 6),
                clippedStake: round(sizing.clippedStake, 6),
                decisionStatus: sizing.status,
                reasonsJson: sizing.reasons as Prisma.InputJsonValue
              }
            });

            await tx.stakeRecommendation.update({
              where: { stakeCandidateId: candidate.id },
              data: {
                recommendedFraction: round(sizing.recommendedFraction, 6),
                recommendedStake: round(sizing.recommendedStake, 6),
                clippedStake: round(sizing.clippedStake, 6),
                decisionStatus: sizing.status,
                reasonsJson: sizing.reasons as Prisma.InputJsonValue
              }
            });

            return sizing;
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }
  private async stageExposureCheck(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "exposureCheck"), async () => {
            const settings = await this.configService.getSettings();
            if (!settings.exposureGovernanceEnabled) {
              return null;
            }

            const candidate = await tx.stakeCandidate.findUnique({ where: { dedupKey: payload.dedupBaseKey } });
            if (!candidate) {
              return null;
            }

            const recommendation = await tx.stakeRecommendation.findUnique({
              where: {
                stakeCandidateId: candidate.id
              }
            });

            if (!recommendation) {
              return null;
            }

            const proposedStake = recommendation.clippedStake ?? recommendation.recommendedStake ?? 0;
            if (proposedStake <= 0) {
              return null;
            }

            const account = await tx.bankrollAccount.findUnique({ where: { id: payload.accountId } });
            if (!account) {
              throw new Error("bankroll_account_not_found");
            }

            const limits = await tx.exposureLimit.findMany({
              where: {
                bankrollAccountId: payload.accountId,
                isActive: true
              }
            });

            const openOrders = await tx.paperOrder.findMany({
              where: {
                bankrollAccountId: payload.accountId,
                status: "OPEN"
              },
              select: {
                stake: true,
                ticketDecision: {
                  select: {
                    legs: {
                      select: {
                        matchId: true,
                        market: true,
                        horizon: true,
                        match: {
                          select: {
                            leagueId: true,
                            sport: {
                              select: {
                                code: true
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            });

            const openExposureTotal = openOrders.reduce((sum, row) => sum + row.stake, 0);
            let openExposureByMatch = 0;
            let openExposureByLeague = 0;
            let openExposureBySport = 0;
            let openExposureByFamily = 0;
            let openExposureByHorizon = 0;

            const marketFamily = resolveMarketFamily(candidate.market);
            for (const order of openOrders) {
              const leg = order.ticketDecision.legs[0];
              if (!leg) {
                continue;
              }
              if (leg.matchId === candidate.matchId) {
                openExposureByMatch += order.stake;
              }
              if (leg.match?.leagueId && leg.match.leagueId === payload.publishedSelection.leagueId) {
                openExposureByLeague += order.stake;
              }
              if (leg.match?.sport?.code && leg.match.sport.code.toLowerCase() === candidate.sportCode.toLowerCase()) {
                openExposureBySport += order.stake;
              }
              if (resolveMarketFamily(leg.market) === marketFamily) {
                openExposureByFamily += order.stake;
              }
              if (leg.horizon === candidate.horizon) {
                openExposureByHorizon += order.stake;
              }
            }

            const exposure = this.exposureCheckService.evaluate(
              {
                accountId: payload.accountId,
                bankrollValue: account.availableBalance + account.reservedBalance,
                proposedStake,
                sportCode: candidate.sportCode,
                leagueId: payload.publishedSelection.leagueId,
                matchId: candidate.matchId,
                marketFamily,
                horizon: candidate.horizon,
                calendarKey: toCalendarKey(new Date()),
                openExposureTotal,
                openExposureByMatch,
                openExposureByLeague,
                openExposureBySport,
                openExposureByFamily,
                openExposureByHorizon,
                openTickets: openOrders.length
              },
              limits
            );

            const reasons = [...((recommendation.reasonsJson as string[] | null) ?? []), ...exposure.reasons];

            await tx.stakeRecommendation.update({
              where: {
                stakeCandidateId: candidate.id
              },
              data: {
                clippedStake: round(exposure.stakeAfterGovernance, 6),
                decisionStatus: exposure.status,
                reasonsJson: reasons as Prisma.InputJsonValue
              }
            });

            await tx.stakeCandidate.update({
              where: { id: candidate.id },
              data: {
                clippedStake: round(exposure.stakeAfterGovernance, 6),
                decisionStatus: exposure.status,
                reasonsJson: reasons as Prisma.InputJsonValue
              }
            });

            for (const evaluation of exposure.evaluations) {
              const exposureTotal = account.availableBalance + account.reservedBalance;
              const utilization = exposureTotal > 0 ? clamp(evaluation.allowedStake / exposureTotal, 0, 1) : 0;
              await tx.exposureSnapshot.create({
                data: {
                  bankrollAccountId: payload.accountId,
                  scopeType: evaluation.scopeType,
                  scopeKey: evaluation.scopeKey,
                  openExposure: round(openExposureTotal, 6),
                  bankrollValue: round(exposureTotal, 6),
                  utilization: round(utilization, 6),
                  detailsJson: {
                    reason: evaluation.reason,
                    allowedStake: evaluation.allowedStake,
                    behavior: evaluation.behavior,
                    blocked: evaluation.blocked,
                    breached: evaluation.breached
                  }
                }
              });

              if (evaluation.breached && evaluation.behavior !== "ALLOW") {
                await tx.riskLimitBreach.create({
                  data: {
                    bankrollAccountId: payload.accountId,
                    severity: evaluation.blocked ? "CRITICAL" : "WARNING",
                    scopeType: evaluation.scopeType,
                    scopeKey: evaluation.scopeKey,
                    behavior: evaluation.behavior,
                    limitValue: null,
                    observedValue: round(openExposureTotal + proposedStake, 6),
                    actionStatus: evaluation.blocked ? "BLOCKED" : "CLIPPED",
                    reason: evaluation.reason
                  }
                });
              }
            }

            return exposure;
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  private async stageCorrelationCheck(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "correlationCheck"), async () => {
            const settings = await this.configService.getSettings();
            if (!settings.correlationChecksEnabled) {
              return null;
            }

            const candidate = await tx.stakeCandidate.findUnique({ where: { dedupKey: payload.dedupBaseKey } });
            if (!candidate) {
              return null;
            }
            const recommendation = await tx.stakeRecommendation.findUnique({
              where: {
                stakeCandidateId: candidate.id
              }
            });
            if (!recommendation) {
              return null;
            }

            const proposedStake = recommendation.clippedStake ?? recommendation.recommendedStake ?? 0;
            if (proposedStake <= 0) {
              return null;
            }

            const openLegs = await tx.ticketLeg.findMany({
              where: {
                matchId: candidate.matchId,
                ticketDecision: {
                  paperOrder: {
                    is: {
                      status: "OPEN"
                    }
                  }
                }
              },
              select: {
                market: true,
                selection: true,
                line: true,
                horizon: true
              }
            });

            const correlation = this.correlationCheckService.evaluate({
              matchId: candidate.matchId,
              market: candidate.market,
              selection: candidate.selection,
              line: candidate.line,
              horizon: candidate.horizon,
              proposedStake,
              existingOpenLegs: openLegs
            });

            const reasons = [...((recommendation.reasonsJson as string[] | null) ?? []), ...correlation.reasons];

            await tx.stakeRecommendation.update({
              where: { stakeCandidateId: candidate.id },
              data: {
                clippedStake: round(correlation.stakeAfterCorrelation, 6),
                decisionStatus: correlation.status,
                reasonsJson: reasons as Prisma.InputJsonValue
              }
            });

            await tx.stakeCandidate.update({
              where: { id: candidate.id },
              data: {
                clippedStake: round(correlation.stakeAfterCorrelation, 6),
                decisionStatus: correlation.status,
                reasonsJson: reasons as Prisma.InputJsonValue
              }
            });

            await tx.correlationGroup.upsert({
              where: {
                bankrollAccountId_groupKey: {
                  bankrollAccountId: payload.accountId,
                  groupKey: correlation.correlationGroupKey
                }
              },
              update: {
                marketFamily: resolveMarketFamily(candidate.market),
                correlationScore: correlation.status === StakeDecisionStatus.BLOCKED ? 1 : correlation.status === StakeDecisionStatus.CLIPPED ? 0.5 : 0,
                detailsJson: {
                  reasons: correlation.reasons,
                  stakeAfterCorrelation: correlation.stakeAfterCorrelation
                }
              },
              create: {
                bankrollAccountId: payload.accountId,
                groupKey: correlation.correlationGroupKey,
                marketFamily: resolveMarketFamily(candidate.market),
                correlationScore: correlation.status === StakeDecisionStatus.BLOCKED ? 1 : correlation.status === StakeDecisionStatus.CLIPPED ? 0.5 : 0,
                detailsJson: {
                  reasons: correlation.reasons,
                  stakeAfterCorrelation: correlation.stakeAfterCorrelation
                }
              }
            });

            return correlation;
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }
  private async stageTicketConstruction(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "ticketConstruction"), async () => {
            const candidate = await tx.stakeCandidate.findUnique({ where: { dedupKey: payload.dedupBaseKey } });
            if (!candidate) {
              return null;
            }
            const recommendation = await tx.stakeRecommendation.findUnique({
              where: {
                stakeCandidateId: candidate.id
              }
            });
            if (!recommendation) {
              return null;
            }

            const ticketEval = this.ticketConstructionService.evaluate({
              bankrollAccountId: payload.accountId,
              stakeRecommendationId: recommendation.id,
              stakingPolicyVersionId: recommendation.stakingPolicyVersionId,
              profileKey: payload.profileKey,
              decisionStatus: recommendation.decisionStatus,
              finalStake: recommendation.clippedStake ?? recommendation.recommendedStake ?? 0,
              candidate: {
                sportCode: candidate.sportCode,
                matchId: candidate.matchId,
                market: candidate.market,
                line: candidate.line,
                lineKey: candidate.lineKey,
                horizon: candidate.horizon,
                selection: candidate.selection,
                publishedPredictionId: candidate.publishedPredictionId,
                calibratedProbability: candidate.calibratedProbability,
                fairOdds: candidate.fairOdds,
                offeredOdds: candidate.offeredOdds,
                edge: candidate.edge,
                confidence: candidate.confidence,
                publishScore: candidate.publishScore
              },
              reasons: (recommendation.reasonsJson as string[] | null) ?? []
            });

            return this.ticketConstructionService.persist(
              tx,
              {
                bankrollAccountId: payload.accountId,
                stakeRecommendationId: recommendation.id,
                stakingPolicyVersionId: recommendation.stakingPolicyVersionId,
                profileKey: payload.profileKey,
                decisionStatus: recommendation.decisionStatus,
                finalStake: ticketEval.stake,
                candidate: {
                  sportCode: candidate.sportCode,
                  matchId: candidate.matchId,
                  market: candidate.market,
                  line: candidate.line,
                  lineKey: candidate.lineKey,
                  horizon: candidate.horizon,
                  selection: candidate.selection,
                  publishedPredictionId: candidate.publishedPredictionId,
                  calibratedProbability: candidate.calibratedProbability,
                  fairOdds: candidate.fairOdds,
                  offeredOdds: candidate.offeredOdds,
                  edge: candidate.edge,
                  confidence: candidate.confidence,
                  publishScore: candidate.publishScore
                },
                reasons: ticketEval.reasons
              },
              ticketEval
            );
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  private async stagePaperExecution(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "paperExecution"), async () => {
            const settings = await this.configService.getSettings();
            if (!settings.paperExecutionEnabled) {
              return null;
            }

            const candidate = await tx.stakeCandidate.findUnique({ where: { dedupKey: payload.dedupBaseKey } });
            if (!candidate) {
              return null;
            }

            const ticketDecision = await tx.ticketDecision.findFirst({
              where: {
                ticketCandidate: {
                  stakeRecommendation: {
                    is: {
                      stakeCandidateId: candidate.id
                    }
                  }
                }
              },
              include: {
                legs: true,
                paperOrder: true
              }
            });

            if (!ticketDecision) {
              return null;
            }

            const dedupKey = `paper:${ticketDecision.id}`;
            const order = await this.paperExecutionService.executeSingleTicket(tx, {
              bankrollAccountId: payload.accountId,
              ticketDecisionId: ticketDecision.id,
              ticketStatus: ticketDecision.decisionStatus,
              stake: ticketDecision.totalStake,
              effectiveOdds: ticketDecision.effectiveOdds,
              dedupKey,
              details: {
                source: "bankroll_pipeline"
              }
            });

            if (order) {
              await this.accountingService.reserveForPaperOrder(tx, {
                accountId: payload.accountId,
                paperOrderId: order.id,
                stake: order.stake
              });
            }

            return order;
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  private async stageSettlement(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "settlement"), async () => {
            const settled = await this.settlementService.settleOpenOrders(tx, {
              accountId: payload.accountId,
              limit: 50
            });

            for (const item of settled) {
              const order = await tx.paperOrder.findUnique({
                where: { id: item.paperOrderId },
                select: { stake: true }
              });
              if (!order) {
                continue;
              }

              await this.accountingService.settlePaperOrder(tx, {
                accountId: payload.accountId,
                paperOrderId: item.paperOrderId,
                stake: order.stake,
                payout: item.outcome.payout,
                pnl: item.outcome.pnl
              });
            }

            return {
              settled: settled.length
            };
          }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  private async stageBankrollAccounting(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "bankrollAccounting"), async () =>
            this.accountingService.recomputeFromLedger(tx, payload.accountId)
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  private async stageSimulationAnalytics(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "simulationAnalytics"), async () =>
            this.simulationService.runHistoricalSimulation(tx, {
              bankrollAccountId: payload.accountId,
              profileKey: payload.profileKey,
              simulationName: "pipeline_auto_simulation",
              config: {
                source: "bankroll_pipeline",
                dedupBaseKey: payload.dedupBaseKey
              },
              randomSeed: 42,
              windowStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              windowEnd: new Date()
            })
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }

  private async stageRoiGovernance(payload: BankrollJobPayload) {
    return this.runSerializable(async () =>
      this.prisma.$transaction(
        async (tx) =>
          this.withStageLock(tx, this.advisoryKey(payload.dedupBaseKey, "roiGovernance"), async () =>
            this.governanceService.evaluate(tx, payload.accountId)
          ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      )
    );
  }
  private async processStage(stage: BankrollStage, payload: BankrollJobPayload) {
    if (stage === "stakeCandidateBuild") {
      return this.stageStakeCandidateBuild(payload);
    }
    if (stage === "stakeSizing") {
      return this.stageStakeSizing(payload);
    }
    if (stage === "exposureCheck") {
      return this.stageExposureCheck(payload);
    }
    if (stage === "correlationCheck") {
      return this.stageCorrelationCheck(payload);
    }
    if (stage === "ticketConstruction") {
      return this.stageTicketConstruction(payload);
    }
    if (stage === "portfolioDecision") {
      return {
        status: "portfolio_decision_pass_through"
      };
    }
    if (stage === "paperExecution") {
      return this.stagePaperExecution(payload);
    }
    if (stage === "settlement") {
      return this.stageSettlement(payload);
    }
    if (stage === "bankrollAccounting") {
      return this.stageBankrollAccounting(payload);
    }
    if (stage === "simulationAnalytics") {
      return this.stageSimulationAnalytics(payload);
    }
    return this.stageRoiGovernance(payload);
  }

  private async enqueueFlow(payload: BankrollJobPayload) {
    const sharedOpts = {
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 2,
      backoff: {
        type: "exponential" as const,
        delay: 1500
      }
    };

    const createNode = (stage: BankrollStage, children?: Array<Record<string, unknown>>) => ({
      name: stage,
      queueName: BANKROLL_QUEUE,
      data: {
        ...payload,
        stage
      },
      opts: {
        ...sharedOpts,
        jobId: `${payload.dedupBaseKey}:${stage}`
      },
      ...(children && children.length > 0 ? { children } : {})
    });

    let root = createNode(BANKROLL_PIPELINE_STAGES[0]);
    for (let index = 1; index < BANKROLL_PIPELINE_STAGES.length; index += 1) {
      root = createNode(BANKROLL_PIPELINE_STAGES[index], [root]);
    }

    return this.flow().add(root as any);
  }

  private async runInline(payload: BankrollJobPayload) {
    for (const stage of BANKROLL_PIPELINE_STAGES) {
      await this.processStage(stage, payload);
    }
  }

  async processPublishedSelection(selection: PublishedSelectionInput) {
    const settings = await this.configService.getSettings();
    if (!settings.bankrollLayerEnabled || settings.emergencyKillSwitch) {
      return {
        skipped: true,
        reason: "bankroll_layer_disabled"
      };
    }

    if (
      selection.publishDecisionStatus !== PublishDecisionStatus.APPROVED &&
      selection.publishDecisionStatus !== PublishDecisionStatus.MANUALLY_FORCED
    ) {
      return {
        skipped: true,
        reason: "not_publishable_status"
      };
    }

    const account = await this.configService.resolvePrimaryAccount();
    const policyVersion = await this.configService.resolveActivePolicyVersion();
    const profileKey = settings.stakingProfileDefault || account.profileDefault;

    const payload: BankrollJobPayload = {
      stage: "stakeCandidateBuild",
      dedupBaseKey: this.buildBaseDedup(selection),
      publishedSelection: {
        ...selection,
        line: selection.line === null || !Number.isFinite(selection.line) ? null : round(selection.line, 2),
        selection: normalizeSelectionToken(selection.selection)
      },
      accountId: account.id,
      policyVersionId: policyVersion.id,
      profileKey
    };

    try {
      await this.enqueueFlow(payload);
      return {
        queued: true,
        dedupBaseKey: payload.dedupBaseKey
      };
    } catch (error) {
      this.logger.warn(
        `bankroll flow enqueue failed for ${payload.dedupBaseKey}, fallback inline: ${error instanceof Error ? error.message : "unknown"}`
      );
      await this.runInline(payload);
      return {
        queued: false,
        dedupBaseKey: payload.dedupBaseKey
      };
    }
  }
  async ensureSchedulers() {
    if (this.schedulersInstalled) {
      return;
    }

    const lockKey = "bankroll-schedulers";
    const owner = `${process.pid}:${Date.now()}`;
    const acquired = await this.cache.acquireLock(lockKey, owner, 20_000);
    if (!acquired) {
      return;
    }

    try {
      await this.bankrollQueue.upsertJobScheduler(
        "bankroll-hourly-settlement",
        { every: 60 * 60 * 1000 },
        {
          name: "settlement",
          data: {
            source: "scheduler"
          },
          opts: {
            removeOnComplete: 1000,
            removeOnFail: 1000
          }
        }
      );

      await this.bankrollQueue.upsertJobScheduler(
        "bankroll-hourly-governance",
        { every: 60 * 60 * 1000 },
        {
          name: "roiGovernance",
          data: {
            source: "scheduler"
          },
          opts: {
            removeOnComplete: 1000,
            removeOnFail: 1000
          }
        }
      );

      await this.bankrollQueue.upsertJobScheduler(
        "bankroll-daily-simulation",
        { every: 24 * 60 * 60 * 1000 },
        {
          name: "simulationAnalytics",
          data: {
            source: "scheduler"
          },
          opts: {
            removeOnComplete: 1000,
            removeOnFail: 1000
          }
        }
      );

      this.schedulersInstalled = true;
    } finally {
      await this.cache.releaseLock(lockKey, owner);
    }
  }

  async startWorker() {
    if (this.worker) {
      return;
    }
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";

    this.worker = new Worker(
      BANKROLL_QUEUE,
      async (job) => {
        const stage = job.name as BankrollStage;
        const data = job.data as Partial<BankrollJobPayload>;

        if (["settlement", "simulationAnalytics", "roiGovernance"].includes(stage) && data?.publishedSelection === undefined) {
          const settings = await this.configService.getSettings();
          if (!settings.bankrollLayerEnabled || settings.emergencyKillSwitch) {
            return;
          }
          const account = await this.configService.resolvePrimaryAccount();
          const policyVersion = await this.configService.resolveActivePolicyVersion();
          const schedulerPayload: BankrollJobPayload = {
            stage,
            dedupBaseKey: `${stage}:scheduler:${new Date().toISOString().slice(0, 13)}`,
            publishedSelection: {
              sportCode: "football",
              matchId: "scheduler",
              leagueId: null,
              market: "scheduler",
              line: null,
              horizon: "PRE24",
              selection: "home",
              predictionRunId: "scheduler",
              modelVersionId: null,
              calibrationVersionId: null,
              publishedPredictionId: "scheduler",
              publishDecisionId: "scheduler",
              publishDecisionStatus: PublishDecisionStatus.APPROVED,
              calibratedProbability: 0.5,
              fairOdds: null,
              offeredOdds: null,
              edge: null,
              confidence: 0.5,
              publishScore: 0.5,
              freshnessScore: null,
              coverageFlags: {},
              volatilityScore: null,
              providerDisagreement: null
            },
            accountId: account.id,
            policyVersionId: policyVersion.id,
            profileKey: settings.stakingProfileDefault || account.profileDefault
          };
          await this.processStage(stage, schedulerPayload);
          return;
        }

        if (!data || !data.publishedSelection || !data.accountId || !data.policyVersionId || !data.profileKey || !data.dedupBaseKey) {
          return;
        }

        const payload: BankrollJobPayload = {
          stage,
          dedupBaseKey: String(data.dedupBaseKey),
          publishedSelection: data.publishedSelection,
          accountId: String(data.accountId),
          policyVersionId: String(data.policyVersionId),
          profileKey: data.profileKey as BankrollProfileKey
        };

        await this.processStage(stage, payload);
      },
      {
        connection: { url },
        concurrency: Math.max(1, Math.min(4, Number(process.env.BANKROLL_WORKER_CONCURRENCY ?? 2) || 2))
      }
    );

    this.worker.on("failed", (job, error) => {
      this.logger.error(
        `bankroll stage failed: ${job?.name ?? "unknown"} ${job?.id ?? ""}`,
        error instanceof Error ? error.stack : undefined
      );
    });

    this.worker.on("completed", (job) => {
      this.logger.log(
        JSON.stringify({
          event: "bankroll_stage_completed",
          stage: job.name,
          jobId: job.id ? String(job.id) : null,
          dedupBaseKey: typeof job.data?.dedupBaseKey === "string" ? job.data.dedupBaseKey : null
        })
      );
    });
  }
}
