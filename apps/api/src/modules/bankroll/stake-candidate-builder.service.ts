import { Injectable } from "@nestjs/common";
import { BankrollProfileKey, Prisma, StakeDecisionStatus } from "@prisma/client";
import { normalizeLineKey, normalizeSelectionToken, round } from "./bankroll-market-family.util";

export type StakeCandidateBuildInput = {
  sportCode: string;
  matchId: string;
  market: string;
  line: number | null;
  horizon: string;
  selection: string;
  publishedPredictionId: string;
  predictionRunId: string;
  modelVersionId: string | null;
  calibrationVersionId: string | null;
  bankrollAccountId: string;
  profileKey: BankrollProfileKey;
  stakingPolicyVersionId: string | null;
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

@Injectable()
export class StakeCandidateBuilderService {
  buildDedupKey(input: StakeCandidateBuildInput) {
    return [
      input.sportCode.trim().toLowerCase(),
      input.matchId,
      input.market.trim().toLowerCase(),
      normalizeLineKey(input.line),
      input.horizon.trim().toUpperCase(),
      normalizeSelectionToken(input.selection),
      input.publishedPredictionId
    ].join(":");
  }

  async upsert(
    tx: Prisma.TransactionClient,
    input: StakeCandidateBuildInput
  ) {
    const lineKey = normalizeLineKey(input.line);
    const selection = normalizeSelectionToken(input.selection);
    const dedupKey = this.buildDedupKey(input);

    return tx.stakeCandidate.upsert({
      where: { dedupKey },
      update: {
        sportCode: input.sportCode,
        market: input.market,
        line: input.line,
        lineKey,
        horizon: input.horizon,
        selection,
        publishedPredictionId: input.publishedPredictionId,
        predictionRunId: input.predictionRunId,
        modelVersionId: input.modelVersionId,
        calibrationVersionId: input.calibrationVersionId,
        bankrollAccountId: input.bankrollAccountId,
        profileKey: input.profileKey,
        stakingPolicyVersionId: input.stakingPolicyVersionId,
        calibratedProbability: round(input.calibratedProbability, 6),
        fairOdds: input.fairOdds,
        offeredOdds: input.offeredOdds,
        edge: input.edge,
        confidence: round(input.confidence, 6),
        publishScore: round(input.publishScore, 6),
        freshnessScore: input.freshnessScore,
        coverageFlagsJson: input.coverageFlags as Prisma.InputJsonValue,
        volatilityScore: input.volatilityScore,
        providerDisagreement: input.providerDisagreement,
        decisionStatus: StakeDecisionStatus.CREATED,
        reasonsJson: [] as Prisma.InputJsonValue
      },
      create: {
        sportCode: input.sportCode,
        matchId: input.matchId,
        market: input.market,
        line: input.line,
        lineKey,
        horizon: input.horizon,
        selection,
        publishedPredictionId: input.publishedPredictionId,
        predictionRunId: input.predictionRunId,
        modelVersionId: input.modelVersionId,
        calibrationVersionId: input.calibrationVersionId,
        bankrollAccountId: input.bankrollAccountId,
        profileKey: input.profileKey,
        stakingPolicyVersionId: input.stakingPolicyVersionId,
        calibratedProbability: round(input.calibratedProbability, 6),
        fairOdds: input.fairOdds,
        offeredOdds: input.offeredOdds,
        edge: input.edge,
        confidence: round(input.confidence, 6),
        publishScore: round(input.publishScore, 6),
        freshnessScore: input.freshnessScore,
        coverageFlagsJson: input.coverageFlags as Prisma.InputJsonValue,
        volatilityScore: input.volatilityScore,
        providerDisagreement: input.providerDisagreement,
        decisionStatus: StakeDecisionStatus.CREATED,
        reasonsJson: [] as Prisma.InputJsonValue,
        dedupKey
      }
    });
  }
}
