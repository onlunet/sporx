import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

export type BuildPredictionCandidateInput = {
  matchId: string;
  market: string;
  line: number | null;
  horizon: string;
  selection: string;
  predictionRunId: string;
  metaModelRunId?: string | null;
  modelVersionId?: string | null;
  calibrationVersionId?: string | null;
  coreProbability: number;
  refinedProbability?: number | null;
  calibratedProbability: number;
  confidence: number;
  publishScore: number;
  fairOdds?: number | null;
  edge?: number | null;
  freshnessScore?: number | null;
  coverageFlags?: Record<string, unknown> | null;
  volatilityScore?: number | null;
  providerDisagreement?: number | null;
  lineupCoverage?: number | null;
  eventCoverage?: number | null;
  strategyProfile: string;
  policyVersionId?: string | null;
};

@Injectable()
export class CandidateBuilderService {
  private round(value: number, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private lineKey(line: number | null) {
    if (line === null || !Number.isFinite(line)) {
      return "na";
    }
    return Number(line).toFixed(2);
  }

  async buildAndPersist(tx: Prisma.TransactionClient, input: BuildPredictionCandidateInput) {
    const normalizedSelection = input.selection.trim().toLowerCase();
    const existing = await tx.predictionCandidate.findUnique({
      where: {
        predictionRunId_selection: {
          predictionRunId: input.predictionRunId,
          selection: normalizedSelection
        }
      }
    });
    if (existing) {
      return existing;
    }

    return tx.predictionCandidate.create({
      data: {
        matchId: input.matchId,
        market: input.market,
        line: input.line,
        lineKey: this.lineKey(input.line),
        horizon: input.horizon,
        selection: normalizedSelection,
        predictionRunId: input.predictionRunId,
        metaModelRunId: input.metaModelRunId ?? null,
        modelVersionId: input.modelVersionId ?? null,
        calibrationVersionId: input.calibrationVersionId ?? null,
        coreProbability: this.clamp(this.round(input.coreProbability), 0.0001, 0.9999),
        refinedProbability:
          input.refinedProbability === null || input.refinedProbability === undefined
            ? null
            : this.clamp(this.round(input.refinedProbability), 0.0001, 0.9999),
        calibratedProbability: this.clamp(this.round(input.calibratedProbability), 0.0001, 0.9999),
        confidence: this.clamp(this.round(input.confidence), 0, 1),
        publishScore: this.clamp(this.round(input.publishScore), 0, 1),
        fairOdds: input.fairOdds === null || input.fairOdds === undefined ? null : this.round(input.fairOdds),
        edge: input.edge === null || input.edge === undefined ? null : this.round(input.edge),
        freshnessScore:
          input.freshnessScore === null || input.freshnessScore === undefined
            ? null
            : this.clamp(this.round(input.freshnessScore), 0, 1),
        coverageFlagsJson: (input.coverageFlags ?? null) as Prisma.InputJsonValue,
        volatilityScore:
          input.volatilityScore === null || input.volatilityScore === undefined
            ? null
            : this.clamp(this.round(input.volatilityScore), 0, 1),
        providerDisagreement:
          input.providerDisagreement === null || input.providerDisagreement === undefined
            ? null
            : this.clamp(this.round(input.providerDisagreement), 0, 1),
        lineupCoverage:
          input.lineupCoverage === null || input.lineupCoverage === undefined
            ? null
            : this.clamp(this.round(input.lineupCoverage), 0, 1),
        eventCoverage:
          input.eventCoverage === null || input.eventCoverage === undefined
            ? null
            : this.clamp(this.round(input.eventCoverage), 0, 1),
        strategyProfile: input.strategyProfile,
        policyVersionId: input.policyVersionId ?? null
      }
    });
  }
}
