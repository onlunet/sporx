import { Injectable, Logger } from "@nestjs/common";
import { Prisma, PublishDecisionStatus } from "@prisma/client";
import { AbstainPolicyService } from "./abstain-policy.service";
import { ConflictResolutionService } from "./conflict-resolution.service";
import { SelectionEngineConfigService } from "./selection-engine-config.service";
import { SelectionScoreService } from "./selection-score.service";
import { CandidateSnapshot, SelectionAbstainReason, SelectionEngineSettings, StrategyProfileConfig, StrategyProfileKey } from "./publish-selection.types";

type EvaluatePublishDecisionInput = {
  tx: Prisma.TransactionClient;
  candidate: {
    id: string;
    matchId: string;
    market: string;
    line: number | null;
    lineKey: string;
    horizon: string;
    selection: string;
    predictionRunId: string;
    modelVersionId: string | null;
    calibrationVersionId: string | null;
    calibratedProbability: number;
    confidence: number;
    publishScore: number;
    fairOdds: number | null;
    edge: number | null;
    freshnessScore: number | null;
    coverageFlagsJson: Prisma.JsonValue | null;
    volatilityScore: number | null;
    providerDisagreement: number | null;
    lineupCoverage: number | null;
    eventCoverage: number | null;
  };
  leagueId: string | null;
  strategyProfile: StrategyProfileKey;
  profileConfig: StrategyProfileConfig;
  policyVersionId: string;
  policyVersionLabel: string;
  settings: SelectionEngineSettings;
};

@Injectable()
export class PublishDecisionService {
  private readonly logger = new Logger(PublishDecisionService.name);

  constructor(
    private readonly selectionScoreService: SelectionScoreService,
    private readonly abstainPolicyService: AbstainPolicyService,
    private readonly conflictResolutionService: ConflictResolutionService,
    private readonly selectionConfigService: SelectionEngineConfigService
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

  private toRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private uniqueReasons(reasons: SelectionAbstainReason[]) {
    const seen = new Set<string>();
    const output: SelectionAbstainReason[] = [];
    for (const reason of reasons) {
      if (seen.has(reason.code)) {
        continue;
      }
      seen.add(reason.code);
      output.push(reason);
    }
    return output;
  }

  private classifyStatus(reasons: SelectionAbstainReason[]): PublishDecisionStatus {
    if (reasons.length === 0) {
      return PublishDecisionStatus.APPROVED;
    }

    if (reasons.some((reason) => reason.code === "MANUAL_BLOCK")) {
      return PublishDecisionStatus.BLOCKED;
    }

    if (reasons.some((reason) => reason.code === "DUPLICATE_CANDIDATE" || reason.code === "CONFLICTING_CANDIDATE")) {
      return PublishDecisionStatus.SUPPRESSED;
    }

    if (reasons.some((reason) => reason.code === "POLICY_BLOCKED" || reason.code === "UNSUPPORTED_MARKET" || reason.code === "UNSUPPORTED_LEAGUE")) {
      return PublishDecisionStatus.BLOCKED;
    }

    return PublishDecisionStatus.ABSTAINED;
  }

  async evaluateAndPersist(input: EvaluatePublishDecisionInput) {
    const coverageFlags = this.toRecord(input.candidate.coverageFlagsJson);
    const candidateSnapshot: CandidateSnapshot = {
      id: input.candidate.id,
      matchId: input.candidate.matchId,
      market: input.candidate.market,
      line: input.candidate.line,
      lineKey: input.candidate.lineKey,
      horizon: input.candidate.horizon,
      selection: input.candidate.selection,
      confidence: input.candidate.confidence,
      calibratedProbability: input.candidate.calibratedProbability,
      publishScore: input.candidate.publishScore,
      edge: input.candidate.edge,
      freshnessScore: input.candidate.freshnessScore,
      volatilityScore: input.candidate.volatilityScore,
      providerDisagreement: input.candidate.providerDisagreement,
      lineupCoverage: input.candidate.lineupCoverage,
      eventCoverage: input.candidate.eventCoverage,
      strategyProfile: input.strategyProfile,
      coverageFlags,
      leagueId: input.leagueId
    };

    const scoring = this.selectionScoreService.score({
      calibratedProbability: candidateSnapshot.calibratedProbability,
      confidence: candidateSnapshot.confidence,
      edge: candidateSnapshot.edge,
      freshnessScore: candidateSnapshot.freshnessScore,
      volatilityScore: candidateSnapshot.volatilityScore,
      providerDisagreement: candidateSnapshot.providerDisagreement,
      coverageFlags: candidateSnapshot.coverageFlags,
      profile: input.profileConfig
    });

    let reasons = this.abstainPolicyService.evaluate({
      candidate: candidateSnapshot,
      selectionScore: scoring.score,
      profile: input.profileConfig
    });

    const manualOverride = await this.selectionConfigService.resolveManualOverride({
      matchId: input.candidate.matchId,
      market: input.candidate.market,
      lineKey: input.candidate.lineKey,
      horizon: input.candidate.horizon,
      selection: input.candidate.selection
    });

    if (manualOverride?.action === "BLOCK") {
      reasons.push({
        code: "MANUAL_BLOCK",
        message: "Candidate blocked by manual override.",
        severity: "high",
        details: {
          overrideId: manualOverride.id,
          reason: manualOverride.reason
        }
      });
    }

    let suppressedDecisionIds: string[] = [];
    if (manualOverride?.action !== "FORCE" && reasons.length === 0) {
      const conflicts = await this.conflictResolutionService.resolve(
        input.tx,
        {
          matchId: input.candidate.matchId,
          market: input.candidate.market,
          line: input.candidate.line,
          lineKey: input.candidate.lineKey,
          horizon: input.candidate.horizon,
          selection: input.candidate.selection,
          selectionScore: scoring.score,
          profileMaxPicksPerMatch: input.profileConfig.maxPicksPerMatch,
          policyVersionId: input.policyVersionId
        },
        async (marketFamily) => {
          const rows = await this.selectionConfigService.getConflictRules(input.policyVersionId, marketFamily);
          return rows.map((row) => ({
            maxPicksPerMatch: row.maxPicksPerMatch,
            allowMultiHorizon: row.allowMultiHorizon
          }));
        }
      );
      if (conflicts.reasons.length > 0) {
        reasons = reasons.concat(conflicts.reasons);
      }
      suppressedDecisionIds = conflicts.suppressedDecisionIds;
    }

    reasons = this.uniqueReasons(reasons);

    let status = this.classifyStatus(reasons);
    if (manualOverride?.action === "FORCE") {
      status = PublishDecisionStatus.MANUALLY_FORCED;
      reasons = [];
    }

    const shouldPublishByDecision =
      status === PublishDecisionStatus.APPROVED || status === PublishDecisionStatus.MANUALLY_FORCED;
    const shouldPublishPublic =
      !input.settings.enabled ||
      input.settings.emergencyRollback ||
      input.settings.shadowMode ||
      shouldPublishByDecision;

    const decision = await input.tx.publishDecision.upsert({
      where: { candidateId: input.candidate.id },
      update: {
        matchId: input.candidate.matchId,
        market: input.candidate.market,
        line: input.candidate.line,
        lineKey: input.candidate.lineKey,
        horizon: input.candidate.horizon,
        selection: input.candidate.selection,
        predictionRunId: input.candidate.predictionRunId,
        modelVersionId: input.candidate.modelVersionId,
        calibrationVersionId: input.candidate.calibrationVersionId,
        policyVersionId: input.policyVersionId,
        strategyProfile: input.strategyProfile,
        status,
        shadowMode: input.settings.shadowMode,
        selectionScore: scoring.score,
        confidence: input.candidate.confidence,
        publishScore: input.candidate.publishScore,
        fairOdds: input.candidate.fairOdds,
        edge: input.candidate.edge,
        freshnessScore: input.candidate.freshnessScore,
        coverageFlagsJson: coverageFlags as Prisma.InputJsonValue,
        volatilityScore: input.candidate.volatilityScore,
        providerDisagreement: input.candidate.providerDisagreement,
        abstainReasonsJson: reasons as unknown as Prisma.InputJsonValue,
        detailsJson: {
          policyVersionLabel: input.policyVersionLabel,
          scoreBreakdown: scoring.breakdown,
          manualOverride: manualOverride
            ? {
                id: manualOverride.id,
                action: manualOverride.action,
                reason: manualOverride.reason
              }
            : null,
          shadowPassthrough: input.settings.shadowMode
        } as Prisma.InputJsonValue,
        isPublicPublished: shouldPublishPublic,
        publishedAt: shouldPublishPublic ? new Date() : null
      },
      create: {
        candidateId: input.candidate.id,
        matchId: input.candidate.matchId,
        market: input.candidate.market,
        line: input.candidate.line,
        lineKey: input.candidate.lineKey,
        horizon: input.candidate.horizon,
        selection: input.candidate.selection,
        predictionRunId: input.candidate.predictionRunId,
        modelVersionId: input.candidate.modelVersionId,
        calibrationVersionId: input.candidate.calibrationVersionId,
        policyVersionId: input.policyVersionId,
        strategyProfile: input.strategyProfile,
        status,
        shadowMode: input.settings.shadowMode,
        selectionScore: scoring.score,
        confidence: input.candidate.confidence,
        publishScore: input.candidate.publishScore,
        fairOdds: input.candidate.fairOdds,
        edge: input.candidate.edge,
        freshnessScore: input.candidate.freshnessScore,
        coverageFlagsJson: coverageFlags as Prisma.InputJsonValue,
        volatilityScore: input.candidate.volatilityScore,
        providerDisagreement: input.candidate.providerDisagreement,
        abstainReasonsJson: reasons as unknown as Prisma.InputJsonValue,
        detailsJson: {
          policyVersionLabel: input.policyVersionLabel,
          scoreBreakdown: scoring.breakdown,
          manualOverride: manualOverride
            ? {
                id: manualOverride.id,
                action: manualOverride.action,
                reason: manualOverride.reason
              }
            : null,
          shadowPassthrough: input.settings.shadowMode
        } as Prisma.InputJsonValue,
        isPublicPublished: shouldPublishPublic,
        publishedAt: shouldPublishPublic ? new Date() : null
      }
    });

    await input.tx.abstainReasonLog.deleteMany({ where: { decisionId: decision.id } });
    if (reasons.length > 0) {
      await input.tx.abstainReasonLog.createMany({
        data: reasons.map((reason) => ({
          decisionId: decision.id,
          reasonCode: reason.code,
          reasonText: reason.message,
          severity: reason.severity,
          detailsJson: (reason.details ?? null) as Prisma.InputJsonValue
        }))
      });
    }

    if (suppressedDecisionIds.length > 0) {
      await input.tx.publishDecision.updateMany({
        where: { id: { in: suppressedDecisionIds } },
        data: {
          status: PublishDecisionStatus.SUPPRESSED,
          isPublicPublished: false,
          publishedAt: null
        }
      });
      try {
        await input.tx.publishedPrediction.deleteMany({
          where: {
            publishDecisionId: { in: suppressedDecisionIds }
          }
        });
      } catch (error) {
        if (!this.isMissingPublishedPredictionsTableError(error)) {
          throw error;
        }
        this.logger.warn(
          `published_predictions table missing; skipped suppressed publish cleanup for ${suppressedDecisionIds.length} decisions.`
        );
      }
    }

    await input.tx.policyEvaluationSnapshot.create({
      data: {
        matchId: input.candidate.matchId,
        market: input.candidate.market,
        line: input.candidate.line,
        lineKey: input.candidate.lineKey,
        horizon: input.candidate.horizon,
        selection: input.candidate.selection,
        candidateId: input.candidate.id,
        decisionId: decision.id,
        policyVersionId: input.policyVersionId,
        strategyProfile: input.strategyProfile,
        shadowMode: input.settings.shadowMode,
        approved: status === PublishDecisionStatus.APPROVED || status === PublishDecisionStatus.MANUALLY_FORCED,
        abstained: status === PublishDecisionStatus.ABSTAINED,
        suppressed: status === PublishDecisionStatus.SUPPRESSED,
        blocked: status === PublishDecisionStatus.BLOCKED,
        candidateMetrics: {
          confidence: input.candidate.confidence,
          calibratedProbability: input.candidate.calibratedProbability,
          publishScore: input.candidate.publishScore,
          edge: input.candidate.edge,
          freshness: input.candidate.freshnessScore,
          volatility: input.candidate.volatilityScore,
          providerDisagreement: input.candidate.providerDisagreement
        } as Prisma.InputJsonValue,
        decisionMetrics: {
          selectionScore: scoring.score,
          scoreBreakdown: scoring.breakdown,
          reasons,
          shouldPublishPublic
        } as Prisma.InputJsonValue
      }
    });

    return {
      decision,
      reasons,
      shouldPublishPublic,
      shouldPublishByDecision,
      selectionScore: scoring.score,
      status
    };
  }
}
