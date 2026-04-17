import { Injectable } from "@nestjs/common";
import { CandidateCoverageFlags, SelectionScoreBreakdown, StrategyProfileConfig } from "./publish-selection.types";

type SelectionScoreInput = {
  calibratedProbability: number;
  confidence: number;
  edge: number | null;
  freshnessScore: number | null;
  volatilityScore: number | null;
  providerDisagreement: number | null;
  coverageFlags: CandidateCoverageFlags;
  profile: StrategyProfileConfig;
};

@Injectable()
export class SelectionScoreService {
  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private round(value: number, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
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

  private coverageScore(flags: CandidateCoverageFlags, profile: StrategyProfileConfig) {
    const hasOdds = Boolean(flags.has_odds);
    const hasLineup = Boolean(flags.has_lineup);
    const hasEvent = Boolean(flags.has_event_data);
    const missingStatsRatio = this.clamp(this.asNumber(flags.missing_stats_ratio) ?? 0.35, 0, 1);

    let score = 0.15;
    score += hasOdds ? 0.35 : profile.requireOdds ? 0 : 0.12;
    score += hasLineup ? 0.2 : 0.05;
    score += hasEvent ? 0.2 : 0.08;
    score += this.clamp(1 - missingStatsRatio, 0, 1) * 0.1;
    return this.clamp(score, 0, 1);
  }

  score(input: SelectionScoreInput) {
    const confidence = this.clamp(input.confidence, 0, 1);
    const calibrated = this.clamp(input.calibratedProbability, 0.0001, 0.9999);
    const edge = this.clamp(input.edge ?? 0, -0.2, 0.5);
    const freshness = this.clamp(input.freshnessScore ?? 0.5, 0, 1);
    const volatility = this.clamp(input.volatilityScore ?? 0, 0, 1);
    const disagreement = this.clamp(input.providerDisagreement ?? 0, 0, 1);

    const confidenceComponent = confidence * 0.34;
    const probabilitySharpnessComponent = this.clamp(Math.abs(calibrated - 0.5) * 2, 0, 1) * 0.2;
    const edgeComponent = this.clamp((edge + 0.03) / 0.12, 0, 1) * 0.2;
    const freshnessComponent = freshness * 0.16;
    const coverageComponent = this.coverageScore(input.coverageFlags, input.profile) * 0.1;
    const volatilityPenalty = volatility * 0.07;
    const disagreementPenalty = disagreement * 0.07;

    const raw =
      confidenceComponent +
      probabilitySharpnessComponent +
      edgeComponent +
      freshnessComponent +
      coverageComponent -
      volatilityPenalty -
      disagreementPenalty;

    const score = this.clamp(raw, 0, 1);
    const breakdown: SelectionScoreBreakdown = {
      confidenceComponent: this.round(confidenceComponent),
      probabilitySharpnessComponent: this.round(probabilitySharpnessComponent),
      edgeComponent: this.round(edgeComponent),
      freshnessComponent: this.round(freshnessComponent),
      coverageComponent: this.round(coverageComponent),
      volatilityPenalty: this.round(volatilityPenalty),
      disagreementPenalty: this.round(disagreementPenalty)
    };

    return {
      score: this.round(score),
      breakdown
    };
  }
}
