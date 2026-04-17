import { Injectable } from "@nestjs/common";
import { Prisma, PublishDecisionStatus } from "@prisma/client";
import { SelectionAbstainReason } from "./publish-selection.types";

type ResolveConflictsInput = {
  matchId: string;
  market: string;
  line: number | null;
  lineKey: string;
  horizon: string;
  selection: string;
  selectionScore: number;
  profileMaxPicksPerMatch: number;
  policyVersionId: string | null;
};

type ConflictResolutionResult = {
  suppressed: boolean;
  suppressedDecisionIds: string[];
  reasons: SelectionAbstainReason[];
};

@Injectable()
export class ConflictResolutionService {
  private marketFamily(market: string) {
    const token = market.trim().toLowerCase();
    if (["match_outcome", "match_result", "moneyline", "full_time_result", "first_half_result", "htft", "half_time_full_time"].includes(token)) {
      return "result";
    }
    if (["both_teams_to_score", "btts"].includes(token)) {
      return "btts";
    }
    if (["total_goals_over_under", "over_under", "totals", "goal_range", "first_half_goals", "second_half_goals"].includes(token)) {
      return "totals";
    }
    if (["correct_score"].includes(token)) {
      return "score";
    }
    return "other";
  }

  async resolve(
    tx: Prisma.TransactionClient,
    input: ResolveConflictsInput,
    fetchRules: (marketFamily: string) => Promise<Array<{ maxPicksPerMatch: number; allowMultiHorizon: boolean }>>
  ): Promise<ConflictResolutionResult> {
    const reasons: SelectionAbstainReason[] = [];
    const suppressedDecisionIds: string[] = [];

    const existing = await tx.publishDecision.findMany({
      where: {
        matchId: input.matchId,
        status: {
          in: [PublishDecisionStatus.APPROVED, PublishDecisionStatus.MANUALLY_FORCED]
        }
      },
      select: {
        id: true,
        market: true,
        lineKey: true,
        horizon: true,
        selection: true,
        selectionScore: true,
        status: true
      },
      orderBy: [{ createdAt: "desc" }]
    });

    if (existing.length >= input.profileMaxPicksPerMatch) {
      reasons.push({
        code: "POLICY_BLOCKED",
        message: `Max picks per match reached (${input.profileMaxPicksPerMatch}).`,
        severity: "medium"
      });
    }

    const sameTuple = existing.filter(
      (row) => row.market === input.market && row.lineKey === input.lineKey && row.horizon === input.horizon
    );

    const duplicate = sameTuple.find((row) => row.selection === input.selection);
    if (duplicate) {
      reasons.push({
        code: "DUPLICATE_CANDIDATE",
        message: "An approved candidate already exists for this tuple and selection.",
        severity: "medium"
      });
      return {
        suppressed: true,
        suppressedDecisionIds,
        reasons
      };
    }

    const conflicting = sameTuple.filter((row) => row.selection !== input.selection);
    if (conflicting.length > 0) {
      const strongest = conflicting.sort((left, right) => right.selectionScore - left.selectionScore)[0];
      if (strongest.selectionScore + 0.01 >= input.selectionScore) {
        reasons.push({
          code: "CONFLICTING_CANDIDATE",
          message: "Conflicting candidate with stronger or equal score already published.",
          severity: "high",
          details: {
            strongestScore: strongest.selectionScore,
            candidateScore: input.selectionScore
          }
        });
        return {
          suppressed: true,
          suppressedDecisionIds,
          reasons
        };
      }
      for (const row of conflicting) {
        suppressedDecisionIds.push(row.id);
      }
    }

    const family = this.marketFamily(input.market);
    const rules = await fetchRules(family);
    const maxFamilyPicks = rules.reduce((min, rule) => Math.min(min, rule.maxPicksPerMatch), Number.POSITIVE_INFINITY);
    const familyMax = Number.isFinite(maxFamilyPicks) ? maxFamilyPicks : input.profileMaxPicksPerMatch;
    const allowMultiHorizon = rules.some((rule) => rule.allowMultiHorizon);

    const familyExisting = existing.filter((row) => this.marketFamily(row.market) === family);
    if (familyExisting.length >= familyMax) {
      reasons.push({
        code: "POLICY_BLOCKED",
        message: `Market family pick limit reached (${familyMax}) for ${family}.`,
        severity: "medium"
      });
    }

    if (!allowMultiHorizon && familyExisting.some((row) => row.horizon !== input.horizon)) {
      reasons.push({
        code: "POLICY_BLOCKED",
        message: "Multiple horizons in same market family are blocked by policy.",
        severity: "low"
      });
    }

    return {
      suppressed: reasons.length > 0,
      suppressedDecisionIds,
      reasons
    };
  }
}
