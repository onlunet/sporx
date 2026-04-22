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

type PublishPolicyDiagnostics = {
  version: "publish_policy_refinement_v1";
  enabled: boolean;
  marketRiskProfile: "standard" | "conservative_derived";
  effectiveThresholds: {
    minConfidence: number;
    minPublishScore: number;
    minOddsCoverage: number;
    minLineupCoverage: number;
    minEventCoverage: number;
    maxProviderDisagreement: number;
    maxVolatility: number;
    maxMissingStatsRatio: number;
    minCalibrationSampleSize: number;
    minFreshnessScore: number;
  };
  signals: {
    confidence: number;
    selectionScore: number;
    oddsCoverage: number | null;
    lineupCoverage: number | null;
    eventCoverage: number | null;
    providerDisagreement: number | null;
    volatilityScore: number | null;
    missingStatsRatio: number | null;
    calibrationSampleSize: number | null;
    calibrationMethod: string | null;
  };
  appliedAdjustments: Record<string, number | boolean>;
};

function envNumber(key: string, fallback: number) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(key: string, fallback: boolean) {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

const PUBLISH_POLICY_REFINEMENT_CONFIG = {
  enabled: envBool("PUBLISH_POLICY_REFINEMENT_ENABLED", true),
  minOddsCoverage: envNumber("PUBLISH_POLICY_MIN_ODDS_COVERAGE", 0.45),
  standardMinCalibrationSampleSize: envNumber("PUBLISH_POLICY_MIN_CALIBRATION_SAMPLE", 40),
  riskyMarketMinCalibrationSampleSize: envNumber("PUBLISH_POLICY_RISKY_MARKET_MIN_CALIBRATION_SAMPLE", 80),
  riskyMarketConfidenceDelta: envNumber("PUBLISH_POLICY_RISKY_MARKET_CONFIDENCE_DELTA", 0.03),
  riskyMarketPublishScoreDelta: envNumber("PUBLISH_POLICY_RISKY_MARKET_PUBLISH_SCORE_DELTA", 0.03),
  riskyMarketDisagreementTightening: envNumber("PUBLISH_POLICY_RISKY_MARKET_DISAGREEMENT_TIGHTENING", 0.04),
  riskyMarketMissingStatsTightening: envNumber("PUBLISH_POLICY_RISKY_MARKET_MISSING_STATS_TIGHTENING", 0.08),
  lowCoverageConfidenceDelta: envNumber("PUBLISH_POLICY_LOW_COVERAGE_CONFIDENCE_DELTA", 0.02),
  lowCoveragePublishScoreDelta: envNumber("PUBLISH_POLICY_LOW_COVERAGE_PUBLISH_SCORE_DELTA", 0.02),
  weakCalibrationConfidenceDelta: envNumber("PUBLISH_POLICY_WEAK_CALIBRATION_CONFIDENCE_DELTA", 0.02),
  weakCalibrationPublishScoreDelta: envNumber("PUBLISH_POLICY_WEAK_CALIBRATION_PUBLISH_SCORE_DELTA", 0.02)
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

  private clamp(value: number, min: number, max: number) {
    if (!Number.isFinite(value)) {
      return min;
    }
    return Math.max(min, Math.min(max, value));
  }

  private round(value: number) {
    return Number(value.toFixed(4));
  }

  private asString(value: unknown) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private oddsCoverage(candidate: CandidateSnapshot) {
    return (
      this.asNumber(candidate.coverageFlags.odds_coverage) ??
      this.asNumber(candidate.coverageFlags.market_coverage_score) ??
      this.asNumber(candidate.coverageFlags.marketCoverageScore) ??
      (typeof candidate.coverageFlags.has_odds === "boolean" ? Number(candidate.coverageFlags.has_odds) : null)
    );
  }

  private isRiskyDerivedMarket(market: string) {
    const normalized = market.trim().toLowerCase();
    return [
      "correct_score",
      "half_time_full_time",
      "half_time_fulltime",
      "ht_ft",
      "htft",
      "first_half_result",
      "first_half_outcome",
      "first_half_goals",
      "second_half_goals"
    ].includes(normalized);
  }

  diagnostics(input: EvaluateAbstainInput): PublishPolicyDiagnostics {
    const { candidate, profile } = input;
    const enabled = PUBLISH_POLICY_REFINEMENT_CONFIG.enabled;
    const riskyMarket = enabled && this.isRiskyDerivedMarket(candidate.market);
    const oddsCoverage = this.oddsCoverage(candidate);
    const missingStatsRatio = this.asNumber(candidate.coverageFlags.missing_stats_ratio);
    const calibrationSampleSize = this.asNumber(candidate.coverageFlags.calibration_sample_size);
    const calibrationMethod = this.asString(candidate.coverageFlags.calibration_method);

    const thresholds = {
      minConfidence: profile.minConfidence,
      minPublishScore: profile.minPublishScore,
      minOddsCoverage: PUBLISH_POLICY_REFINEMENT_CONFIG.minOddsCoverage,
      minLineupCoverage: profile.minLineupCoverage,
      minEventCoverage: profile.minEventCoverage,
      maxProviderDisagreement: profile.maxProviderDisagreement,
      maxVolatility: profile.maxVolatility,
      maxMissingStatsRatio: profile.maxMissingStatsRatio,
      minCalibrationSampleSize: riskyMarket
        ? PUBLISH_POLICY_REFINEMENT_CONFIG.riskyMarketMinCalibrationSampleSize
        : PUBLISH_POLICY_REFINEMENT_CONFIG.standardMinCalibrationSampleSize,
      minFreshnessScore: profile.minFreshnessScore
    };

    const adjustments: Record<string, number | boolean> = {
      riskyMarket
    };

    if (enabled && riskyMarket) {
      thresholds.minConfidence += PUBLISH_POLICY_REFINEMENT_CONFIG.riskyMarketConfidenceDelta;
      thresholds.minPublishScore += PUBLISH_POLICY_REFINEMENT_CONFIG.riskyMarketPublishScoreDelta;
      thresholds.maxProviderDisagreement -= PUBLISH_POLICY_REFINEMENT_CONFIG.riskyMarketDisagreementTightening;
      thresholds.maxMissingStatsRatio -= PUBLISH_POLICY_REFINEMENT_CONFIG.riskyMarketMissingStatsTightening;
      adjustments.riskyMarketConfidenceDelta = PUBLISH_POLICY_REFINEMENT_CONFIG.riskyMarketConfidenceDelta;
      adjustments.riskyMarketPublishScoreDelta = PUBLISH_POLICY_REFINEMENT_CONFIG.riskyMarketPublishScoreDelta;
      adjustments.riskyMarketDisagreementTightening = PUBLISH_POLICY_REFINEMENT_CONFIG.riskyMarketDisagreementTightening;
      adjustments.riskyMarketMissingStatsTightening = PUBLISH_POLICY_REFINEMENT_CONFIG.riskyMarketMissingStatsTightening;
    }

    const lowLineupCoverage =
      enabled && candidate.lineupCoverage !== null && candidate.lineupCoverage < thresholds.minLineupCoverage;
    const lowOddsCoverage = enabled && oddsCoverage !== null && oddsCoverage < thresholds.minOddsCoverage;
    const weakCalibration =
      enabled && calibrationSampleSize !== null && calibrationSampleSize < thresholds.minCalibrationSampleSize;

    if (lowLineupCoverage || lowOddsCoverage) {
      thresholds.minConfidence += PUBLISH_POLICY_REFINEMENT_CONFIG.lowCoverageConfidenceDelta;
      thresholds.minPublishScore += PUBLISH_POLICY_REFINEMENT_CONFIG.lowCoveragePublishScoreDelta;
      adjustments.lowCoverageConfidenceDelta = PUBLISH_POLICY_REFINEMENT_CONFIG.lowCoverageConfidenceDelta;
      adjustments.lowCoveragePublishScoreDelta = PUBLISH_POLICY_REFINEMENT_CONFIG.lowCoveragePublishScoreDelta;
    }

    if (weakCalibration) {
      thresholds.minConfidence += PUBLISH_POLICY_REFINEMENT_CONFIG.weakCalibrationConfidenceDelta;
      thresholds.minPublishScore += PUBLISH_POLICY_REFINEMENT_CONFIG.weakCalibrationPublishScoreDelta;
      adjustments.weakCalibrationConfidenceDelta = PUBLISH_POLICY_REFINEMENT_CONFIG.weakCalibrationConfidenceDelta;
      adjustments.weakCalibrationPublishScoreDelta = PUBLISH_POLICY_REFINEMENT_CONFIG.weakCalibrationPublishScoreDelta;
    }

    return {
      version: "publish_policy_refinement_v1",
      enabled,
      marketRiskProfile: riskyMarket ? "conservative_derived" : "standard",
      effectiveThresholds: {
        minConfidence: this.round(this.clamp(thresholds.minConfidence, 0, 0.95)),
        minPublishScore: this.round(this.clamp(thresholds.minPublishScore, 0, 0.95)),
        minOddsCoverage: this.round(this.clamp(thresholds.minOddsCoverage, 0, 1)),
        minLineupCoverage: this.round(this.clamp(thresholds.minLineupCoverage, 0, 1)),
        minEventCoverage: this.round(this.clamp(thresholds.minEventCoverage, 0, 1)),
        maxProviderDisagreement: this.round(this.clamp(thresholds.maxProviderDisagreement, 0, 1)),
        maxVolatility: this.round(this.clamp(thresholds.maxVolatility, 0, 1)),
        maxMissingStatsRatio: this.round(this.clamp(thresholds.maxMissingStatsRatio, 0, 1)),
        minCalibrationSampleSize: Math.max(0, Math.floor(thresholds.minCalibrationSampleSize)),
        minFreshnessScore: this.round(this.clamp(thresholds.minFreshnessScore, 0, 1))
      },
      signals: {
        confidence: this.round(candidate.confidence),
        selectionScore: this.round(input.selectionScore),
        oddsCoverage: oddsCoverage === null ? null : this.round(this.clamp(oddsCoverage, 0, 1)),
        lineupCoverage: candidate.lineupCoverage === null ? null : this.round(this.clamp(candidate.lineupCoverage, 0, 1)),
        eventCoverage: candidate.eventCoverage === null ? null : this.round(this.clamp(candidate.eventCoverage, 0, 1)),
        providerDisagreement:
          candidate.providerDisagreement === null ? null : this.round(this.clamp(candidate.providerDisagreement, 0, 1)),
        volatilityScore: candidate.volatilityScore === null ? null : this.round(this.clamp(candidate.volatilityScore, 0, 1)),
        missingStatsRatio: missingStatsRatio === null ? null : this.round(this.clamp(missingStatsRatio, 0, 1)),
        calibrationSampleSize: calibrationSampleSize === null ? null : Math.max(0, Math.floor(calibrationSampleSize)),
        calibrationMethod
      },
      appliedAdjustments: adjustments
    };
  }

  evaluate(input: EvaluateAbstainInput) {
    const reasons: SelectionAbstainReason[] = [];
    const { candidate, profile } = input;
    const diagnostics = this.diagnostics(input);
    const thresholds = diagnostics.effectiveThresholds;

    if (candidate.confidence < thresholds.minConfidence) {
      this.uniquePush(reasons, {
        code: "LOW_CONFIDENCE",
        message: `Confidence ${candidate.confidence.toFixed(3)} < ${thresholds.minConfidence.toFixed(3)}`,
        severity: "high",
        details: {
          baseThreshold: profile.minConfidence,
          effectiveThreshold: thresholds.minConfidence,
          signal: candidate.confidence,
          marketRiskProfile: diagnostics.marketRiskProfile
        }
      });
    }

    if (input.selectionScore < thresholds.minPublishScore) {
      this.uniquePush(reasons, {
        code: "LOW_PUBLISH_SCORE",
        message: `Selection score ${input.selectionScore.toFixed(3)} < ${thresholds.minPublishScore.toFixed(3)}`,
        severity: "high",
        details: {
          baseThreshold: profile.minPublishScore,
          effectiveThreshold: thresholds.minPublishScore,
          signal: input.selectionScore,
          marketRiskProfile: diagnostics.marketRiskProfile
        }
      });
    }

    if ((candidate.freshnessScore ?? 0.5) < thresholds.minFreshnessScore) {
      this.uniquePush(reasons, {
        code: "STALE_DATA",
        message: `Freshness ${String(candidate.freshnessScore ?? 0)} < ${thresholds.minFreshnessScore.toFixed(3)}`,
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
      if (!hasLineup || (candidate.lineupCoverage ?? 0) < thresholds.minLineupCoverage) {
        this.uniquePush(reasons, {
          code: "MISSING_LINEUP_REQUIRED",
          message: "Lineup coverage is required for this horizon/profile.",
          severity: "high"
        });
      }
    }

    if (candidate.lineupCoverage !== null && candidate.lineupCoverage < thresholds.minLineupCoverage) {
      this.uniquePush(reasons, {
        code: "LOW_LINEUP_COVERAGE",
        message: `Lineup coverage ${candidate.lineupCoverage.toFixed(3)} < ${thresholds.minLineupCoverage.toFixed(3)}`,
        severity: "medium",
        details: {
          effectiveThreshold: thresholds.minLineupCoverage,
          signal: candidate.lineupCoverage,
          marketRiskProfile: diagnostics.marketRiskProfile
        }
      });
    }

    const oddsCoverage = diagnostics.signals.oddsCoverage;
    if (oddsCoverage !== null && oddsCoverage < thresholds.minOddsCoverage) {
      this.uniquePush(reasons, {
        code: "LOW_ODDS_COVERAGE",
        message: `Odds coverage ${oddsCoverage.toFixed(3)} < ${thresholds.minOddsCoverage.toFixed(3)}`,
        severity: "high",
        details: {
          effectiveThreshold: thresholds.minOddsCoverage,
          signal: oddsCoverage,
          marketRiskProfile: diagnostics.marketRiskProfile
        }
      });
    }

    if (candidate.eventCoverage !== null && candidate.eventCoverage < thresholds.minEventCoverage) {
      this.uniquePush(reasons, {
        code: "LOW_EVENT_COVERAGE",
        message: `Event coverage ${candidate.eventCoverage.toFixed(3)} < ${thresholds.minEventCoverage.toFixed(3)}`,
        severity: "medium"
      });
    }

    if ((candidate.volatilityScore ?? 0) > thresholds.maxVolatility) {
      this.uniquePush(reasons, {
        code: "HIGH_VOLATILITY",
        message: `Volatility ${candidate.volatilityScore?.toFixed(3) ?? "0"} > ${thresholds.maxVolatility.toFixed(3)}`,
        severity: "medium"
      });
    }

    if ((candidate.providerDisagreement ?? 0) > thresholds.maxProviderDisagreement) {
      this.uniquePush(reasons, {
        code: "HIGH_PROVIDER_DISAGREEMENT",
        message: `Provider disagreement ${candidate.providerDisagreement?.toFixed(3) ?? "0"} > ${thresholds.maxProviderDisagreement.toFixed(3)}`,
        severity: "medium",
        details: {
          baseThreshold: profile.maxProviderDisagreement,
          effectiveThreshold: thresholds.maxProviderDisagreement,
          signal: candidate.providerDisagreement ?? 0,
          marketRiskProfile: diagnostics.marketRiskProfile
        }
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
    if (missingStatsRatio > thresholds.maxMissingStatsRatio) {
      this.uniquePush(reasons, {
        code: "LOW_HISTORICAL_SUPPORT",
        message: `Missing stats ratio ${missingStatsRatio.toFixed(3)} > ${thresholds.maxMissingStatsRatio.toFixed(3)}`,
        severity: "medium",
        details: {
          baseThreshold: profile.maxMissingStatsRatio,
          effectiveThreshold: thresholds.maxMissingStatsRatio,
          signal: missingStatsRatio,
          marketRiskProfile: diagnostics.marketRiskProfile
        }
      });
    }

    const calibrationSampleSize = diagnostics.signals.calibrationSampleSize;
    if (calibrationSampleSize !== null && calibrationSampleSize < thresholds.minCalibrationSampleSize) {
      this.uniquePush(reasons, {
        code: "WEAK_CALIBRATION_SAMPLE",
        message: `Calibration sample ${calibrationSampleSize} < ${thresholds.minCalibrationSampleSize}`,
        severity: diagnostics.marketRiskProfile === "conservative_derived" ? "high" : "medium",
        details: {
          effectiveThreshold: thresholds.minCalibrationSampleSize,
          signal: calibrationSampleSize,
          calibrationMethod: diagnostics.signals.calibrationMethod,
          marketRiskProfile: diagnostics.marketRiskProfile
        }
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
