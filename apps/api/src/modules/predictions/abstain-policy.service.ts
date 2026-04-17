import { Injectable } from "@nestjs/common";
import {
  CandidateSnapshot,
  SelectionAbstainReason,
  SelectionAbstainReasonCode,
  StrategyProfileConfig
} from "./publish-selection.types";

type EvaluateAbstainInput = {
  candidate: CandidateSnapshot;
  selectionScore: number;
  profile: StrategyProfileConfig;
  policyBlocked?: boolean;
};

@Injectable()
export class AbstainPolicyService {
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

  private uniquePush(
    target: SelectionAbstainReason[],
    reason: {
      code: SelectionAbstainReasonCode;
      message: string;
      severity: "low" | "medium" | "high";
      details?: Record<string, unknown>;
    }
  ) {
    if (target.some((item) => item.code === reason.code)) {
      return;
    }
    target.push(reason);
  }

  evaluate(input: EvaluateAbstainInput) {
    const reasons: SelectionAbstainReason[] = [];
    const { candidate, profile } = input;

    if (candidate.confidence < profile.minConfidence) {
      this.uniquePush(reasons, {
        code: "LOW_CONFIDENCE",
        message: `Confidence ${candidate.confidence.toFixed(3)} < ${profile.minConfidence.toFixed(3)}`,
        severity: "high"
      });
    }

    if (input.selectionScore < profile.minPublishScore) {
      this.uniquePush(reasons, {
        code: "LOW_PUBLISH_SCORE",
        message: `Selection score ${input.selectionScore.toFixed(3)} < ${profile.minPublishScore.toFixed(3)}`,
        severity: "high"
      });
    }

    if ((candidate.freshnessScore ?? 0.5) < profile.minFreshnessScore) {
      this.uniquePush(reasons, {
        code: "STALE_DATA",
        message: `Freshness ${String(candidate.freshnessScore ?? 0)} < ${profile.minFreshnessScore.toFixed(3)}`,
        severity: "medium"
      });
    }

    if (profile.requireOdds && !Boolean(candidate.coverageFlags.has_odds)) {
      this.uniquePush(reasons, {
        code: "MISSING_ODDS",
        message: "Profile requires odds coverage.",
        severity: "high"
      });
    }

    const requiresLineup = profile.requireLineupHorizons.includes(candidate.horizon.toUpperCase());
    if (requiresLineup) {
      const hasLineup = Boolean(candidate.coverageFlags.has_lineup);
      if (!hasLineup || (candidate.lineupCoverage ?? 0) < profile.minLineupCoverage) {
        this.uniquePush(reasons, {
          code: "MISSING_LINEUP_REQUIRED",
          message: "Lineup coverage is required for this horizon/profile.",
          severity: "high"
        });
      }
    }

    if (candidate.eventCoverage !== null && candidate.eventCoverage < profile.minEventCoverage) {
      this.uniquePush(reasons, {
        code: "LOW_EVENT_COVERAGE",
        message: `Event coverage ${candidate.eventCoverage.toFixed(3)} < ${profile.minEventCoverage.toFixed(3)}`,
        severity: "medium"
      });
    }

    if ((candidate.volatilityScore ?? 0) > profile.maxVolatility) {
      this.uniquePush(reasons, {
        code: "HIGH_VOLATILITY",
        message: `Volatility ${candidate.volatilityScore?.toFixed(3) ?? "0"} > ${profile.maxVolatility.toFixed(3)}`,
        severity: "medium"
      });
    }

    if ((candidate.providerDisagreement ?? 0) > profile.maxProviderDisagreement) {
      this.uniquePush(reasons, {
        code: "HIGH_PROVIDER_DISAGREEMENT",
        message: `Provider disagreement ${candidate.providerDisagreement?.toFixed(3) ?? "0"} > ${profile.maxProviderDisagreement.toFixed(3)}`,
        severity: "medium"
      });
    }

    if (profile.allowedMarkets.length > 0 && !profile.allowedMarkets.includes(candidate.market.toLowerCase())) {
      this.uniquePush(reasons, {
        code: "UNSUPPORTED_MARKET",
        message: "Market is not allowed by active strategy profile.",
        severity: "high"
      });
    }

    if (profile.allowedHorizons.length > 0 && !profile.allowedHorizons.includes(candidate.horizon.toUpperCase())) {
      this.uniquePush(reasons, {
        code: "UNSUPPORTED_MARKET",
        message: "Horizon is not allowed by active strategy profile.",
        severity: "high"
      });
    }

    if (profile.allowedLeagueIds.length > 0) {
      if (!candidate.leagueId || !profile.allowedLeagueIds.includes(candidate.leagueId)) {
        this.uniquePush(reasons, {
          code: "UNSUPPORTED_LEAGUE",
          message: "League is not allowed by active strategy profile.",
          severity: "high"
        });
      }
    }

    const missingStatsRatio = this.asNumber(candidate.coverageFlags.missing_stats_ratio) ?? 0;
    if (missingStatsRatio > profile.maxMissingStatsRatio) {
      this.uniquePush(reasons, {
        code: "LOW_HISTORICAL_SUPPORT",
        message: `Missing stats ratio ${missingStatsRatio.toFixed(3)} > ${profile.maxMissingStatsRatio.toFixed(3)}`,
        severity: "medium"
      });
    }

    if (profile.valueOnly && (candidate.edge ?? 0) < profile.minEdge) {
      this.uniquePush(reasons, {
        code: "POLICY_BLOCKED",
        message: `Value-only mode active and edge ${(candidate.edge ?? 0).toFixed(4)} < ${profile.minEdge.toFixed(4)}`,
        severity: "high"
      });
    }

    if (input.policyBlocked) {
      this.uniquePush(reasons, {
        code: "POLICY_BLOCKED",
        message: "Blocked by policy constraints.",
        severity: "high"
      });
    }

    return reasons;
  }
}
