import { Injectable } from "@nestjs/common";
import { StakeDecisionStatus } from "@prisma/client";
import { CorrelationCheckInput, CorrelationCheckResult } from "./bankroll.types";
import { normalizeSelectionToken, resolveMarketFamily, round } from "./bankroll-market-family.util";

@Injectable()
export class CorrelationCheckService {
  private asPair(market: string, selection: string) {
    return `${resolveMarketFamily(market)}:${normalizeSelectionToken(selection)}`;
  }

  private isCorrelated(
    left: { market: string; selection: string; line: number | null; horizon: string },
    right: { market: string; selection: string; line: number | null; horizon: string }
  ) {
    const leftFamily = resolveMarketFamily(left.market);
    const rightFamily = resolveMarketFamily(right.market);
    const leftSelection = normalizeSelectionToken(left.selection);
    const rightSelection = normalizeSelectionToken(right.selection);

    if (leftFamily === rightFamily) {
      return true;
    }

    if (
      (leftFamily === "totals" && rightFamily === "btts" && leftSelection === "over" && rightSelection === "yes") ||
      (rightFamily === "totals" && leftFamily === "btts" && rightSelection === "over" && leftSelection === "yes")
    ) {
      return true;
    }

    if (
      (leftFamily === "team_total" && rightFamily === "totals" && leftSelection === "over" && rightSelection === "over") ||
      (rightFamily === "team_total" && leftFamily === "totals" && rightSelection === "over" && leftSelection === "over")
    ) {
      return true;
    }

    const pairLeft = this.asPair(left.market, left.selection);
    const pairRight = this.asPair(right.market, right.selection);
    const key = `${pairLeft}|${pairRight}`;

    const correlatedPairs = new Set([
      "totals:over|btts:yes",
      "btts:yes|totals:over",
      "result:home|result:home",
      "result:away|result:away",
      "correct_score:1-0|totals:under",
      "totals:under|correct_score:1-0",
      "team_total:over|totals:over",
      "totals:over|team_total:over",
      "first_half_result:over|totals:over"
    ]);

    if (correlatedPairs.has(key)) {
      return true;
    }

    if (left.horizon !== right.horizon && leftFamily === rightFamily) {
      return true;
    }

    return false;
  }

  evaluate(input: CorrelationCheckInput): CorrelationCheckResult {
    const reasons: string[] = [];
    const marketFamily = resolveMarketFamily(input.market);
    const correlatedFamilies = new Set(["totals", "btts", "team_total", "result", "correct_score", "first_half_result"]);
    const correlationGroupKey = `${input.matchId}:${marketFamily}`;

    const correlatedCount = input.existingOpenLegs.filter((existing) => {
      const existingFamily = resolveMarketFamily(existing.market);
      if (existingFamily === marketFamily) {
        return true;
      }
      if (correlatedFamilies.has(existingFamily) && correlatedFamilies.has(marketFamily)) {
        return true;
      }
      return this.isCorrelated(
        {
          market: input.market,
          selection: input.selection,
          line: input.line,
          horizon: input.horizon
        },
        existing
      );
    }).length;

    if (correlatedCount === 0) {
      return {
        status: StakeDecisionStatus.SIZED,
        stakeAfterCorrelation: round(input.proposedStake, 6),
        correlationGroupKey,
        reasons
      };
    }

    if (correlatedCount >= 2) {
      reasons.push("CORRELATION_BLOCKED");
      return {
        status: StakeDecisionStatus.BLOCKED,
        stakeAfterCorrelation: 0,
        correlationGroupKey,
        reasons
      };
    }

    const clippedStake = round(input.proposedStake * 0.5, 6);
    reasons.push("CORRELATION_CLIPPED");

    return {
      status: StakeDecisionStatus.CLIPPED,
      stakeAfterCorrelation: clippedStake,
      correlationGroupKey,
      reasons
    };
  }
}
