import { Injectable } from "@nestjs/common";
import { StakeDecisionStatus } from "@prisma/client";
import { StakeSizingInput, StakeSizingResult } from "./bankroll.types";
import { clamp, round } from "./bankroll-market-family.util";

@Injectable()
export class StakeSizingService {
  private sanitizeOdds(value: number | null) {
    if (value === null || !Number.isFinite(value) || value <= 1) {
      return null;
    }
    return value;
  }

  private baseKellyFraction(probability: number, offeredOdds: number) {
    const b = offeredOdds - 1;
    if (b <= 0) {
      return 0;
    }
    const q = 1 - probability;
    const kelly = (b * probability - q) / b;
    return Math.max(0, kelly);
  }

  score(input: StakeSizingInput): StakeSizingResult {
    const reasons: string[] = [];
    const edge = input.edge ?? 0;

    if (edge <= 0) {
      reasons.push("NON_POSITIVE_EDGE");
      return {
        status: StakeDecisionStatus.NO_STAKE,
        recommendedFraction: 0,
        recommendedStake: 0,
        clippedStake: 0,
        reasons
      };
    }

    if (input.confidence < input.config.minConfidence) {
      reasons.push("LOW_CONFIDENCE");
      return {
        status: StakeDecisionStatus.NO_STAKE,
        recommendedFraction: 0,
        recommendedStake: 0,
        clippedStake: 0,
        reasons
      };
    }

    if (input.publishScore < input.config.minPublishScore) {
      reasons.push("LOW_PUBLISH_SCORE");
      return {
        status: StakeDecisionStatus.NO_STAKE,
        recommendedFraction: 0,
        recommendedStake: 0,
        clippedStake: 0,
        reasons
      };
    }

    if (edge < input.config.minEdge) {
      reasons.push("EDGE_BELOW_POLICY_MIN");
      return {
        status: StakeDecisionStatus.NO_STAKE,
        recommendedFraction: 0,
        recommendedStake: 0,
        clippedStake: 0,
        reasons
      };
    }

    const offeredOdds = this.sanitizeOdds(input.offeredOdds);
    if (!offeredOdds) {
      reasons.push("MISSING_OR_STALE_ODDS");
      return {
        status: StakeDecisionStatus.NO_STAKE,
        recommendedFraction: 0,
        recommendedStake: 0,
        clippedStake: 0,
        reasons
      };
    }

    const bankroll = Math.max(0, input.bankrollAvailable);
    if (bankroll <= 0) {
      reasons.push("BANKROLL_EMPTY");
      return {
        status: StakeDecisionStatus.BLOCKED,
        recommendedFraction: 0,
        recommendedStake: 0,
        clippedStake: 0,
        reasons
      };
    }

    let recommendedFraction = 0;
    if (input.profile === "FLAT_UNIT") {
      recommendedFraction = clamp(input.config.flatUnit / bankroll, 0, input.config.hardMaxFractionPerBet);
      reasons.push("PROFILE_FLAT_UNIT");
    } else if (input.profile === "RISK_BUDGETED") {
      const quality = clamp((input.confidence + input.publishScore + clamp(edge * 10, 0, 1)) / 3, 0, 1);
      recommendedFraction = clamp(quality * input.config.riskBudgetFraction, 0, input.config.hardMaxFractionPerBet);
      reasons.push("PROFILE_RISK_BUDGETED");
    } else {
      const rawKelly = this.baseKellyFraction(input.calibratedProbability, offeredOdds);
      const kellyFraction = input.profile === "FRACTIONAL_KELLY" ? input.config.kellyFraction : Math.min(input.config.kellyFraction, 0.5);
      recommendedFraction = clamp(rawKelly * kellyFraction, 0, input.config.hardMaxFractionPerBet);
      reasons.push(input.profile === "FRACTIONAL_KELLY" ? "PROFILE_FRACTIONAL_KELLY" : "PROFILE_CAPPED_FRACTIONAL_KELLY");
    }

    const recommendedStake = round(bankroll * recommendedFraction, 6);
    const clippedStake = clamp(recommendedStake, input.config.minStake, input.config.maxStake);

    if (clippedStake < input.config.minStake || clippedStake <= 0) {
      reasons.push("STAKE_BELOW_MIN");
      return {
        status: StakeDecisionStatus.NO_STAKE,
        recommendedFraction,
        recommendedStake,
        clippedStake: 0,
        reasons
      };
    }

    const wasClipped = Math.abs(clippedStake - recommendedStake) > 1e-9;
    if (wasClipped) {
      reasons.push("CLIPPED_BY_STAKE_LIMIT");
    }

    return {
      status: wasClipped ? StakeDecisionStatus.CLIPPED : StakeDecisionStatus.SIZED,
      recommendedFraction,
      recommendedStake,
      clippedStake,
      reasons
    };
  }
}
