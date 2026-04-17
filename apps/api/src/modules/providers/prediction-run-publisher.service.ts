import { Injectable, Logger } from "@nestjs/common";
import { MatchStatus, Prisma } from "@prisma/client";
import { CalibrationService } from "../calibration/calibration.service";
import { PrismaService } from "../../prisma/prisma.service";
import { FeatureSnapshotService } from "../predictions/feature-snapshot.service";
import { isLivePredictionHorizon, resolveFootballPredictionHorizon } from "../predictions/prediction-horizon.util";
import { ShadowEvaluationService } from "../predictions/shadow-evaluation.service";
import { EnrichmentFlagsService } from "../predictions/enrichment-flags.service";
import { LineupSnapshotService } from "../predictions/lineup-snapshot.service";
import { EventEnrichmentService } from "../predictions/event-enrichment.service";
import { MarketConsensusSnapshotService } from "../predictions/market-consensus-snapshot.service";
import { MetaModelRefinementService } from "../predictions/meta-model-refinement.service";
import { CandidateBuilderService } from "../predictions/candidate-builder.service";
import { PublishDecisionService } from "../predictions/publish-decision.service";
import { SelectionEngineConfigService } from "../predictions/selection-engine-config.service";

export type PublishPredictionRunInput = {
  matchId: string;
  matchStatus: MatchStatus;
  kickoffAt?: Date | null;
  elapsedMinute?: number | null;
  hasLineup?: boolean;
  featureCutoffAt?: Date | null;
  market: string;
  line?: number | null;
  selection?: string | null;
  modelVersionId?: string | null;
  probability: number;
  confidence: number;
  riskFlags: unknown;
  explanation: Record<string, unknown>;
};

type NormalizedRiskFlag = {
  code: string;
  severity: string;
  message: string;
};

@Injectable()
export class PredictionRunPublisherService {
  private readonly logger = new Logger(PredictionRunPublisherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureSnapshotService: FeatureSnapshotService,
    private readonly calibrationService: CalibrationService,
    private readonly shadowEvaluationService: ShadowEvaluationService,
    private readonly enrichmentFlags: EnrichmentFlagsService,
    private readonly lineupSnapshotService: LineupSnapshotService,
    private readonly eventEnrichmentService: EventEnrichmentService,
    private readonly marketConsensusSnapshotService: MarketConsensusSnapshotService,
    private readonly metaModelRefinementService: MetaModelRefinementService,
    private readonly candidateBuilderService: CandidateBuilderService,
    private readonly publishDecisionService: PublishDecisionService,
    private readonly selectionEngineConfigService: SelectionEngineConfigService
  ) {}

  private normalizeProbability(value: number) {
    if (!Number.isFinite(value)) {
      return 0.5;
    }
    return Math.max(0.0001, Math.min(0.9999, Number(value.toFixed(6))));
  }

  private normalizeConfidence(value: number) {
    if (!Number.isFinite(value)) {
      return 0.5;
    }
    return Math.max(0, Math.min(1, Number(value.toFixed(6))));
  }

  private normalizeLine(value?: number | null) {
    if (value === undefined || value === null || !Number.isFinite(value)) {
      return null;
    }
    return Number(value.toFixed(2));
  }

  private lineKey(line?: number | null) {
    if (line === null || line === undefined || !Number.isFinite(line)) {
      return "na";
    }
    return Number(line).toFixed(2);
  }

  private normalizeCutoff(value: Date) {
    return new Date(Math.floor(value.getTime() / 1000) * 1000);
  }

  private asRecord(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private asNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private normalizeSelection(selection: string | null | undefined) {
    const token = (selection ?? "").trim().toLowerCase();
    if (["h", "1", "home"].includes(token)) {
      return "home";
    }
    if (["x", "d", "draw"].includes(token)) {
      return "draw";
    }
    if (["a", "2", "away"].includes(token)) {
      return "away";
    }
    if (["y", "yes"].includes(token)) {
      return "yes";
    }
    if (["n", "no"].includes(token)) {
      return "no";
    }
    if (["o", "over"].includes(token)) {
      return "over";
    }
    if (["u", "under"].includes(token)) {
      return "under";
    }
    return token.length > 0 ? token : null;
  }

  private normalizeRiskFlags(input: unknown): NormalizedRiskFlag[] {
    if (!Array.isArray(input)) {
      return [];
    }
    const seen = new Set<string>();
    const output: NormalizedRiskFlag[] = [];
    for (const candidate of input) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        continue;
      }
      const record = candidate as Record<string, unknown>;
      const code =
        typeof record.code === "string" && record.code.trim().length > 0 ? record.code.trim() : "UNSPECIFIED";
      const severity =
        typeof record.severity === "string" && record.severity.trim().length > 0
          ? record.severity.trim()
          : "low";
      const message =
        typeof record.message === "string" && record.message.trim().length > 0
          ? record.message.trim()
          : "Risk sinyali bildirildi.";
      const signature = `${code}|${severity}|${message}`;
      if (seen.has(signature)) {
        continue;
      }
      seen.add(signature);
      output.push({ code, severity, message });
    }
    return output;
  }

  private isRetryableSerializationError(error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") {
      return true;
    }
    if (error && typeof error === "object" && "code" in error) {
      return (error as { code?: string }).code === "P2034";
    }
    return false;
  }

  private async delay(ms: number) {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async withSerializableRetry<T>(handler: () => Promise<T>, maxAttempts = 5): Promise<T> {
    let attempt = 0;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await handler();
      } catch (error) {
        const shouldRetry = this.isRetryableSerializationError(error) && attempt < maxAttempts;
        if (!shouldRetry) {
          throw error;
        }
        await this.delay(Math.min(120, 20 * attempt));
      }
    }
    throw new Error("serializable_transaction_retry_exhausted");
  }

  async publish(input: PublishPredictionRunInput) {
    const now = new Date();
    const kickoffAt = input.kickoffAt ?? now;
    const line = this.normalizeLine(input.line);
    const lineKey = this.lineKey(line);
    const selection = typeof input.selection === "string" && input.selection.trim().length > 0 ? input.selection.trim() : null;
    const horizon = resolveFootballPredictionHorizon({
      status: input.matchStatus,
      kickoffAt,
      now,
      elapsedMinute: input.elapsedMinute,
      hasLineup: input.hasLineup
    });
    const keepLastIfActive = isLivePredictionHorizon(horizon);
    const dedupKey = `match:${input.matchId}:market:${input.market}:line:${lineKey}:h:${horizon}`;
    const defaultCutoffAt =
      input.matchStatus === MatchStatus.scheduled
        ? new Date(Math.min(now.getTime(), kickoffAt.getTime()))
        : now;
    const featureCutoffAt = this.normalizeCutoff(input.featureCutoffAt ?? defaultCutoffAt);

    const baseRiskFlags = this.normalizeRiskFlags(input.riskFlags);
    const selectedSideFromExplanation =
      typeof input.explanation.selectedSide === "string" ? input.explanation.selectedSide : null;
    const calibrationSelection = this.normalizeSelection(selection ?? selectedSideFromExplanation);
    const rawProbability = this.normalizeProbability(input.probability);

    const matchMeta = await this.prisma.match.findUnique({
      where: { id: input.matchId },
      select: {
        leagueId: true
      }
    });
    const leagueId = matchMeta?.leagueId ?? null;
    const selectionEngineSettings = await this.selectionEngineConfigService.getEngineSettings();
    const strategyProfileResolution = await this.selectionEngineConfigService.resolveStrategyProfile({
      leagueId,
      market: input.market,
      horizon
    });

    let snapshotRef:
      | {
          id: string;
          featureHash: string;
          featuresJson: Prisma.JsonValue | null;
          coverage?: Record<string, unknown>;
        }
      | null = null;
    try {
      const snapshot = await this.featureSnapshotService.buildAndPersist({
        matchId: input.matchId,
        horizon,
        featureCutoffAt
      });
      snapshotRef = {
        id: snapshot.id,
        featureHash: snapshot.featureHash,
        featuresJson: snapshot.featuresJson ?? null,
        coverage: snapshot.coverage ?? undefined
      };
    } catch (error) {
      this.logger.warn(
        `feature snapshot skipped for ${input.matchId}/${horizon}: ${error instanceof Error ? error.message : "unknown"}`
      );
    }

    const [lineupEnabled, eventEnabled, oddsMetaEnabled] = await Promise.all([
      this.enrichmentFlags.isEnabled({
        feature: "lineup_enrichment_enabled",
        leagueId,
        market: input.market
      }),
      this.enrichmentFlags.isEnabled({
        feature: "event_enrichment_enabled",
        leagueId,
        market: input.market
      }),
      this.enrichmentFlags.isEnabled({
        feature: "odds_meta_model_enabled",
        leagueId,
        market: input.market
      })
    ]);

    let lineupSnapshotRef: {
      id: string;
      lineupJson: Prisma.JsonValue;
      coverageJson: Prisma.JsonValue;
    } | null = null;
    if (lineupEnabled) {
      try {
        const snapshot = await this.lineupSnapshotService.buildAndPersist({
          matchId: input.matchId,
          horizon,
          cutoffAt: featureCutoffAt
        });
        lineupSnapshotRef = {
          id: snapshot.id,
          lineupJson: snapshot.lineupJson,
          coverageJson: snapshot.coverageJson
        };
      } catch (error) {
        this.logger.warn(
          `lineup snapshot skipped for ${input.matchId}/${horizon}: ${error instanceof Error ? error.message : "unknown"}`
        );
      }
    }

    let eventSnapshotRef: {
      id: string;
      aggregateJson: Prisma.JsonValue;
      coverageJson: Prisma.JsonValue;
    } | null = null;
    if (eventEnabled) {
      try {
        const snapshot = await this.eventEnrichmentService.buildAndPersist({
          matchId: input.matchId,
          horizon,
          cutoffAt: featureCutoffAt
        });
        eventSnapshotRef = {
          id: snapshot.id,
          aggregateJson: snapshot.aggregateJson,
          coverageJson: snapshot.coverageJson
        };
      } catch (error) {
        this.logger.warn(
          `event aggregate snapshot skipped for ${input.matchId}/${horizon}: ${
            error instanceof Error ? error.message : "unknown"
          }`
        );
      }
    }

    let marketConsensusRef: {
      id: string;
      consensusJson: Prisma.JsonValue;
    } | null = null;
    try {
      const snapshot = await this.marketConsensusSnapshotService.buildAndPersist({
        matchId: input.matchId,
        horizon,
        cutoffAt: featureCutoffAt
      });
      marketConsensusRef = {
        id: snapshot.id,
        consensusJson: snapshot.consensusJson
      };
    } catch (error) {
      this.logger.warn(
        `market consensus snapshot skipped for ${input.matchId}/${horizon}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }

    const snapshotFeatures = this.asRecord(snapshotRef?.featuresJson);
    const snapshotCoverage = this.asRecord(snapshotFeatures?.coverageFlags) ?? snapshotRef?.coverage ?? null;
    const oddsFamily = this.asRecord(this.asRecord(snapshotFeatures?.featureFamilies)?.odds);
    const freshnessScore = this.asNumber(snapshotFeatures?.freshnessScore);
    const providerDisagreement = this.asNumber(oddsFamily?.providerDisagreement);
    const lineupCoverageRecord = this.asRecord(lineupSnapshotRef?.coverageJson);
    const eventCoverageRecord = this.asRecord(eventSnapshotRef?.coverageJson);
    const consensusSummary = this.asRecord(this.asRecord(marketConsensusRef?.consensusJson)?.summary);
    const coverageFlags = {
      ...(snapshotCoverage ?? {}),
      has_lineup: Boolean((snapshotCoverage as Record<string, unknown> | null)?.has_lineup ?? lineupCoverageRecord?.has_lineup),
      has_event_data: Boolean(
        (snapshotCoverage as Record<string, unknown> | null)?.has_event_data ?? eventCoverageRecord?.has_event_data
      ),
      has_consensus: Boolean(marketConsensusRef)
    } as Record<string, unknown>;
    const lineupCoverageFromFlags = this.asNumber((coverageFlags as Record<string, unknown>).lineup_coverage);
    const teamsCovered = this.asNumber(lineupCoverageRecord?.teams_covered);
    const lineupCoverage =
      lineupCoverageFromFlags !== null
        ? lineupCoverageFromFlags
        : teamsCovered !== null
          ? teamsCovered / 2
          : typeof lineupCoverageRecord?.has_lineup === "boolean"
            ? Number(lineupCoverageRecord.has_lineup)
            : null;
    const eventCoverage =
      this.asNumber((coverageFlags as Record<string, unknown>).event_coverage) ??
      this.asNumber(eventCoverageRecord?.stats_coverage_ratio);
    const volatilityScore =
      this.asNumber(consensusSummary?.avg_drift_magnitude) ??
      this.asNumber(consensusSummary?.avg_bookmaker_spread) ??
      null;

    const refinement = oddsMetaEnabled
      ? this.metaModelRefinementService.refine({
          matchId: input.matchId,
          market: input.market,
          line,
          horizon,
          cutoffAt: featureCutoffAt,
          selection: calibrationSelection,
          coreProbability: rawProbability,
          coreConfidence: this.normalizeConfidence(input.confidence),
          lineupSnapshot: lineupSnapshotRef
            ? {
                id: lineupSnapshotRef.id,
                lineupJson: lineupSnapshotRef.lineupJson,
                coverageJson: lineupSnapshotRef.coverageJson
              }
            : null,
          eventSnapshot: eventSnapshotRef
            ? {
                id: eventSnapshotRef.id,
                aggregateJson: eventSnapshotRef.aggregateJson,
                coverageJson: eventSnapshotRef.coverageJson
              }
            : null,
          marketConsensusSnapshot: marketConsensusRef
            ? {
                id: marketConsensusRef.id,
                consensusJson: marketConsensusRef.consensusJson
              }
            : null
        })
      : {
          source: "core_model" as const,
          modelVersion: "core_model_v1",
          refinedProbability: rawProbability,
          publishScore: this.normalizeConfidence(input.confidence),
          riskAdjustedConfidence: this.normalizeConfidence(input.confidence),
          isFallback: false,
          fallbackReason: null,
          featureCoverage: {
            hasLineup: Boolean(lineupSnapshotRef),
            hasEvent: Boolean(eventSnapshotRef),
            hasConsensus: Boolean(marketConsensusRef),
            hasMarketProbability: false
          },
          details: {
            reason: "odds_meta_disabled"
          }
        };

    const preCalibrationProbability = this.normalizeProbability(refinement.refinedProbability);

    const calibrated = await this.calibrationService.calibratePrediction({
      market: input.market,
      horizon,
      line,
      selection: calibrationSelection,
      modelVersionId: input.modelVersionId ?? null,
      rawProbability: preCalibrationProbability,
      freshnessScore,
      providerDisagreement,
      coverage: coverageFlags
        ? {
            hasOdds: Boolean((coverageFlags as Record<string, unknown>).has_odds),
            hasLineup: Boolean((coverageFlags as Record<string, unknown>).has_lineup),
            missingStatsRatio: this.asNumber((coverageFlags as Record<string, unknown>).missing_stats_ratio)
          }
        : undefined
    });

    const probability = this.normalizeProbability(calibrated.calibratedProbability);
    const confidence = this.normalizeConfidence(
      (input.confidence + calibrated.confidenceScore + refinement.riskAdjustedConfidence) / 3
    );
    const riskFlags = this.normalizeRiskFlags([
      ...baseRiskFlags,
      ...calibrated.riskFlags,
      ...(oddsMetaEnabled && refinement.isFallback
        ? [
            {
              code: "META_MODEL_FALLBACK",
              severity: "medium",
              message: `Meta-model fallback: ${refinement.fallbackReason ?? "unknown_reason"}`
            }
          ]
        : [])
    ]);

    const startedAt = Date.now();
    try {
      const result = await this.withSerializableRetry(
        () =>
          this.prisma.$transaction(
            async (tx) => {
            await tx.$queryRaw`
              SELECT pg_advisory_xact_lock(
                hashtext(${dedupKey}),
                hashtext(${horizon})
              )
            `;

            const [featureSnapshot, oddsSnapshot] = await Promise.all([
              snapshotRef?.id
                ? tx.featureSnapshot.findUnique({
                    where: { id: snapshotRef.id },
                    select: { id: true }
                  })
                : tx.featureSnapshot.findFirst({
                    where: { matchId: input.matchId, horizon, cutoffAt: { lte: featureCutoffAt } },
                    orderBy: { generatedAt: "desc" },
                    select: { id: true }
                  }),
              tx.oddsSnapshotV2.findFirst({
                where: {
                  matchId: input.matchId,
                  market: input.market,
                  collectedAt: { lte: featureCutoffAt },
                  ...(line === null ? { line: null } : { line })
                },
                orderBy: { collectedAt: "desc" },
                select: { id: true, normalizedProb: true }
              })
            ]);

            const marketProbability = oddsSnapshot?.normalizedProb ?? null;
            const edge = marketProbability !== null ? Number((probability - marketProbability).toFixed(6)) : null;
            const fairOdds = Number((1 / probability).toFixed(6));
            const normalizedSelection = (calibrationSelection ?? "default").trim().toLowerCase();

            const run = await tx.predictionRun.create({
              data: {
                matchId: input.matchId,
                market: input.market,
                line,
                lineKey,
                horizon,
                featureSnapshotId: featureSnapshot?.id ?? null,
                oddsSnapshotId: oddsSnapshot?.id ?? null,
                modelVersionId: input.modelVersionId ?? null,
                calibrationVersionId: null,
                probability,
                fairOdds,
                edge,
                confidence,
                refinedProbability: preCalibrationProbability,
                publishScore: refinement.publishScore,
                riskAdjustedConfidence: refinement.riskAdjustedConfidence,
                refinedSource: refinement.source,
                riskFlagsJson: riskFlags as Prisma.InputJsonValue,
                explanationJson: {
                  ...input.explanation,
                  selectedSide: calibrationSelection,
                  dedupKey,
                  keepLastIfActive,
                  horizon,
                  featureCutoffAt: featureCutoffAt.toISOString(),
                  calibration: calibrated.calibration,
                  calibrationConfidenceScore: calibrated.confidenceScore,
                  enrichment: {
                    lineupSnapshotId: lineupSnapshotRef?.id ?? null,
                    eventAggregateSnapshotId: eventSnapshotRef?.id ?? null,
                    marketConsensusSnapshotId: marketConsensusRef?.id ?? null,
                    metaModelSource: refinement.source,
                    metaModelFallback: refinement.isFallback,
                    metaModelFallbackReason: refinement.fallbackReason,
                    metaModelDetails: refinement.details
                  },
                  selectionEngine: {
                    enabled: selectionEngineSettings.enabled,
                    shadowMode: selectionEngineSettings.shadowMode,
                    strategyProfile: strategyProfileResolution.profileKey,
                    policyVersionId: strategyProfileResolution.policyVersionId
                  }
                } as Prisma.InputJsonValue
              }
            });

            let metaModelRunId: string | null = null;
            if (oddsMetaEnabled) {
              try {
                const metaModelRun = await tx.metaModelRun.create({
                  data: {
                    matchId: input.matchId,
                    market: input.market,
                    line,
                    lineKey,
                    horizon,
                    cutoffAt: featureCutoffAt,
                    predictionRunId: run.id,
                    lineupSnapshotId: lineupSnapshotRef?.id ?? null,
                    eventAggregateSnapshotId: eventSnapshotRef?.id ?? null,
                    marketConsensusSnapshotId: marketConsensusRef?.id ?? null,
                    modelVersion: refinement.modelVersion,
                    coreProbability: rawProbability,
                    refinedProbability: preCalibrationProbability,
                    publishScore: refinement.publishScore,
                    riskAdjustedConfidence: refinement.riskAdjustedConfidence,
                    isFallback: refinement.isFallback,
                    fallbackReason: refinement.fallbackReason,
                    featureCoverageJson: refinement.featureCoverage as Prisma.InputJsonValue,
                    detailsJson: refinement.details as Prisma.InputJsonValue
                  }
                });
                metaModelRunId = metaModelRun.id;
              } catch {
                metaModelRunId = null;
              }
            }

            const candidate = await this.candidateBuilderService.buildAndPersist(tx, {
              matchId: input.matchId,
              market: input.market,
              line,
              horizon,
              selection: normalizedSelection,
              predictionRunId: run.id,
              metaModelRunId,
              modelVersionId: input.modelVersionId ?? null,
              calibrationVersionId: null,
              coreProbability: rawProbability,
              refinedProbability: preCalibrationProbability,
              calibratedProbability: probability,
              confidence,
              publishScore: refinement.publishScore,
              fairOdds,
              edge,
              freshnessScore,
              coverageFlags,
              volatilityScore,
              providerDisagreement,
              lineupCoverage,
              eventCoverage,
              strategyProfile: strategyProfileResolution.profileKey,
              policyVersionId: strategyProfileResolution.policyVersionId
            });

            const selectionDecision = await this.publishDecisionService.evaluateAndPersist({
              tx,
              candidate: {
                id: candidate.id,
                matchId: candidate.matchId,
                market: candidate.market,
                line: candidate.line,
                lineKey: candidate.lineKey,
                horizon: candidate.horizon,
                selection: candidate.selection,
                predictionRunId: candidate.predictionRunId,
                modelVersionId: candidate.modelVersionId,
                calibrationVersionId: candidate.calibrationVersionId,
                calibratedProbability: candidate.calibratedProbability,
                confidence: candidate.confidence,
                publishScore: candidate.publishScore,
                fairOdds: candidate.fairOdds,
                edge: candidate.edge,
                freshnessScore: candidate.freshnessScore,
                coverageFlagsJson: candidate.coverageFlagsJson,
                volatilityScore: candidate.volatilityScore,
                providerDisagreement: candidate.providerDisagreement,
                lineupCoverage: candidate.lineupCoverage,
                eventCoverage: candidate.eventCoverage
              },
              leagueId,
              strategyProfile: strategyProfileResolution.profileKey,
              profileConfig: strategyProfileResolution.profileConfig,
              policyVersionId: strategyProfileResolution.policyVersionId,
              policyVersionLabel: strategyProfileResolution.policyVersionLabel,
              settings: selectionEngineSettings
            });

            let publishedPredictionId: string | null = null;
            if (selectionDecision.shouldPublishPublic) {
              const published = await tx.publishedPrediction.upsert({
                where: {
                  matchId_market_lineKey_horizon: {
                    matchId: input.matchId,
                    market: input.market,
                    lineKey,
                    horizon
                  }
                },
                update: {
                  line,
                  predictionRunId: run.id,
                  publishDecisionId: selectionDecision.decision.id,
                  publishedAt: new Date()
                },
                create: {
                  matchId: input.matchId,
                  market: input.market,
                  line,
                  lineKey,
                  horizon,
                  predictionRunId: run.id,
                  publishDecisionId: selectionDecision.decision.id,
                  publishedAt: new Date()
                }
              });
              publishedPredictionId = `${published.matchId}:${published.market}:${published.lineKey}:${published.horizon}`;
            } else {
              await tx.publishedPrediction.deleteMany({
                where: {
                  matchId: input.matchId,
                  market: input.market,
                  lineKey,
                  horizon
                }
              });
            }

            return {
              runId: run.id,
              metaModelRunId,
              publishedPredictionId,
              decisionStatus: selectionDecision.status,
              publishDecisionId: selectionDecision.decision.id,
              shouldPublishPublic: selectionDecision.shouldPublishPublic,
              selectionScore: selectionDecision.selectionScore,
              dedupKey,
              keepLastIfActive,
              horizon,
              featureHash: snapshotRef?.featureHash ?? null
            };
            },
            {
              isolationLevel: Prisma.TransactionIsolationLevel.Serializable
            }
          ),
        5
      );

      await this.shadowEvaluationService.recordComparison({
        matchId: input.matchId,
        market: input.market,
        line,
        horizon,
        selection: calibrationSelection,
        predictionRunId: result.runId,
        newProbability: probability,
        newConfidence: confidence,
        calibrationBins: calibrated.calibration,
        coverage: coverageFlags as Record<string, unknown>,
        duplicateSuppressed: keepLastIfActive,
        leakageViolation: false,
        latencyMsNew: Date.now() - startedAt,
        details: {
          modelVersionId: input.modelVersionId ?? null,
          dedupKey,
          featureHash: snapshotRef?.featureHash ?? null,
          lineupSnapshotId: lineupSnapshotRef?.id ?? null,
          eventAggregateSnapshotId: eventSnapshotRef?.id ?? null,
          marketConsensusSnapshotId: marketConsensusRef?.id ?? null,
          metaModelSource: refinement.source,
          metaModelFallback: refinement.isFallback,
          metaModelFallbackReason: refinement.fallbackReason,
          decisionStatus: result.decisionStatus ?? null,
          publishDecisionId: result.publishDecisionId ?? null,
          shouldPublishPublic: result.shouldPublishPublic ?? null,
          strategyProfile: strategyProfileResolution.profileKey,
          policyVersionId: strategyProfileResolution.policyVersionId
        }
      });

      this.logger.log(
        JSON.stringify({
          event: "prediction_run_published",
          match_id: input.matchId,
          market: input.market,
          horizon,
          feature_hash: snapshotRef?.featureHash ?? null,
          model_version: input.modelVersionId ?? null,
          calibration_version: null,
          meta_model_source: refinement.source,
          meta_model_fallback: refinement.isFallback,
          published_prediction_id: result.publishedPredictionId,
          decision_status: result.decisionStatus ?? null,
          publish_decision_id: result.publishDecisionId ?? null,
          should_publish_public: result.shouldPublishPublic ?? null,
          strategy_profile: strategyProfileResolution.profileKey,
          policy_version: strategyProfileResolution.policyVersionId,
          dedupId: dedupKey
        })
      );

      return result;
    } catch (error) {
      const errorCode =
        error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "string"
          ? ((error as { code: string }).code as string)
          : null;
      const errorMessage = error instanceof Error ? error.message : "prediction_run_publish_failed";
      try {
        await this.prisma.publishFailureLog.create({
          data: {
            runId: null,
            jobId: null,
            matchId: input.matchId,
            market: input.market,
            lineKey,
            horizon,
            dedupKey,
            errorCode,
            errorMessage,
            details: {
              modelVersionId: input.modelVersionId ?? null,
              featureHash: snapshotRef?.featureHash ?? null
            } as Prisma.InputJsonValue
          }
        });
      } catch {
        // ignore secondary failure log write
      }
      throw error;
    }
  }
}
