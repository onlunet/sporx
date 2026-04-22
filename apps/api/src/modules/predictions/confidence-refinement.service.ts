import { Injectable } from "@nestjs/common";

type RiskFlagInput = {
  code?: string;
  severity?: string;
  message?: string;
};

export type ConfidenceRefinementInput = {
  market: string;
  rawConfidence: number;
  calibrationConfidence: number;
  metaModelConfidence: number;
  calibrationSampleSize?: number | null;
  calibrationEce?: number | null;
  lineupCoverage?: number | null;
  oddsCoverage?: number | null;
  eventCoverage?: number | null;
  freshnessScore?: number | null;
  volatilityScore?: number | null;
  providerDisagreement?: number | null;
  missingStatsRatio?: number | null;
  riskFlags?: RiskFlagInput[] | null;
};

export type ConfidenceDiagnostics = {
  market: string;
  marketProfile: string;
  derivedMarket: boolean;
  rawConfidence: number;
  calibrationConfidence: number;
  metaModelConfidence: number;
  adjustedConfidence: number;
  baselineBlend: number;
  signals: {
    lineupCoverage: number;
    oddsCoverage: number;
    eventCoverage: number;
    freshnessScore: number;
    volatilityScore: number;
    providerDisagreement: number;
    missingStatsRatio: number;
    riskFlagPenalty: number;
    calibrationSampleFactor: number;
    calibrationEce: number | null;
  };
  weights: Record<string, number>;
  components: Record<string, number>;
};

type MarketProfile = {
  profile: string;
  derivedMarket: boolean;
  lineupMultiplier: number;
  oddsMultiplier: number;
  eventMultiplier: number;
  volatilityMultiplier: number;
  disagreementMultiplier: number;
  missingStatsMultiplier: number;
  derivationPenalty: number;
};

const DEFAULT_WEIGHTS = {
  raw: 0.22,
  calibration: 0.43,
  metaModel: 0.35,
  lineupCoverage: 0.045,
  oddsCoverage: 0.045,
  eventCoverage: 0.035,
  freshness: 0.05,
  volatility: 0.08,
  providerDisagreement: 0.08,
  missingStatsRatio: 0.08,
  riskFlags: 0.045,
  calibrationSample: 0.04,
  calibrationEce: 0.04
};

const MARKET_PROFILES: Record<string, MarketProfile> = {
  match_outcome: {
    profile: "primary_outcome",
    derivedMarket: false,
    lineupMultiplier: 1.05,
    oddsMultiplier: 1,
    eventMultiplier: 0.85,
    volatilityMultiplier: 1,
    disagreementMultiplier: 1,
    missingStatsMultiplier: 1,
    derivationPenalty: 0
  },
  match_result: {
    profile: "primary_outcome",
    derivedMarket: false,
    lineupMultiplier: 1.05,
    oddsMultiplier: 1,
    eventMultiplier: 0.85,
    volatilityMultiplier: 1,
    disagreementMultiplier: 1,
    missingStatsMultiplier: 1,
    derivationPenalty: 0
  },
  moneyline: {
    profile: "primary_outcome",
    derivedMarket: false,
    lineupMultiplier: 1,
    oddsMultiplier: 1.05,
    eventMultiplier: 0.85,
    volatilityMultiplier: 1,
    disagreementMultiplier: 1.05,
    missingStatsMultiplier: 1,
    derivationPenalty: 0
  },
  both_teams_to_score: {
    profile: "derived_goal_flow",
    derivedMarket: true,
    lineupMultiplier: 0.85,
    oddsMultiplier: 1.05,
    eventMultiplier: 1.25,
    volatilityMultiplier: 1.15,
    disagreementMultiplier: 1.1,
    missingStatsMultiplier: 1.15,
    derivationPenalty: 0.018
  },
  total_goals_over_under: {
    profile: "derived_total_goals",
    derivedMarket: true,
    lineupMultiplier: 0.8,
    oddsMultiplier: 1.1,
    eventMultiplier: 1.25,
    volatilityMultiplier: 1.2,
    disagreementMultiplier: 1.1,
    missingStatsMultiplier: 1.15,
    derivationPenalty: 0.02
  },
  total_goals: {
    profile: "derived_total_goals",
    derivedMarket: true,
    lineupMultiplier: 0.8,
    oddsMultiplier: 1.1,
    eventMultiplier: 1.25,
    volatilityMultiplier: 1.2,
    disagreementMultiplier: 1.1,
    missingStatsMultiplier: 1.15,
    derivationPenalty: 0.02
  },
  first_half_result: {
    profile: "derived_timing_sensitive",
    derivedMarket: true,
    lineupMultiplier: 1.15,
    oddsMultiplier: 0.9,
    eventMultiplier: 1.15,
    volatilityMultiplier: 1.25,
    disagreementMultiplier: 1,
    missingStatsMultiplier: 1.2,
    derivationPenalty: 0.025
  }
};

@Injectable()
export class ConfidenceRefinementService {
  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private round(value: number, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private number(value: number | null | undefined, fallback: number) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
  }

  private normalizedMarket(market: string) {
    return market.trim().toLowerCase();
  }

  private profileForMarket(market: string): MarketProfile {
    return MARKET_PROFILES[this.normalizedMarket(market)] ?? {
      profile: "generic_derived",
      derivedMarket: true,
      lineupMultiplier: 0.95,
      oddsMultiplier: 1,
      eventMultiplier: 1,
      volatilityMultiplier: 1.1,
      disagreementMultiplier: 1.05,
      missingStatsMultiplier: 1.1,
      derivationPenalty: 0.015
    };
  }

  private envNumber(key: string, fallback: number) {
    const parsed = Number(process.env[key]);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private weights() {
    return {
      raw: this.envNumber("CONFIDENCE_WEIGHT_RAW", DEFAULT_WEIGHTS.raw),
      calibration: this.envNumber("CONFIDENCE_WEIGHT_CALIBRATION", DEFAULT_WEIGHTS.calibration),
      metaModel: this.envNumber("CONFIDENCE_WEIGHT_META_MODEL", DEFAULT_WEIGHTS.metaModel),
      lineupCoverage: this.envNumber("CONFIDENCE_WEIGHT_LINEUP_COVERAGE", DEFAULT_WEIGHTS.lineupCoverage),
      oddsCoverage: this.envNumber("CONFIDENCE_WEIGHT_ODDS_COVERAGE", DEFAULT_WEIGHTS.oddsCoverage),
      eventCoverage: this.envNumber("CONFIDENCE_WEIGHT_EVENT_COVERAGE", DEFAULT_WEIGHTS.eventCoverage),
      freshness: this.envNumber("CONFIDENCE_WEIGHT_FRESHNESS", DEFAULT_WEIGHTS.freshness),
      volatility: this.envNumber("CONFIDENCE_WEIGHT_VOLATILITY", DEFAULT_WEIGHTS.volatility),
      providerDisagreement: this.envNumber(
        "CONFIDENCE_WEIGHT_PROVIDER_DISAGREEMENT",
        DEFAULT_WEIGHTS.providerDisagreement
      ),
      missingStatsRatio: this.envNumber("CONFIDENCE_WEIGHT_MISSING_STATS_RATIO", DEFAULT_WEIGHTS.missingStatsRatio),
      riskFlags: this.envNumber("CONFIDENCE_WEIGHT_RISK_FLAGS", DEFAULT_WEIGHTS.riskFlags),
      calibrationSample: this.envNumber("CONFIDENCE_WEIGHT_CALIBRATION_SAMPLE", DEFAULT_WEIGHTS.calibrationSample),
      calibrationEce: this.envNumber("CONFIDENCE_WEIGHT_CALIBRATION_ECE", DEFAULT_WEIGHTS.calibrationEce)
    };
  }

  private riskFlagPenalty(flags: RiskFlagInput[] | null | undefined) {
    if (!Array.isArray(flags) || flags.length === 0) {
      return 0;
    }
    const penalty = flags.reduce((sum, flag) => {
      const severity = String(flag.severity ?? "").toLowerCase();
      if (severity === "critical") {
        return sum + 1;
      }
      if (severity === "high") {
        return sum + 0.75;
      }
      if (severity === "medium") {
        return sum + 0.42;
      }
      return sum + 0.18;
    }, 0);
    return this.clamp(penalty / 4, 0, 1);
  }

  refine(input: ConfidenceRefinementInput): { confidence: number; diagnostics: ConfidenceDiagnostics } {
    const weights = this.weights();
    const profile = this.profileForMarket(input.market);
    const raw = this.clamp(this.number(input.rawConfidence, 0.5), 0, 1);
    const calibration = this.clamp(this.number(input.calibrationConfidence, raw), 0, 1);
    const meta = this.clamp(this.number(input.metaModelConfidence, calibration), 0, 1);
    const blendWeightSum = Math.max(0.0001, weights.raw + weights.calibration + weights.metaModel);
    const baselineBlend = this.clamp(
      (raw * weights.raw + calibration * weights.calibration + meta * weights.metaModel) / blendWeightSum,
      0,
      1
    );

    const lineupCoverage = this.clamp(this.number(input.lineupCoverage, 0.5), 0, 1);
    const oddsCoverage = this.clamp(this.number(input.oddsCoverage, 0.5), 0, 1);
    const eventCoverage = this.clamp(this.number(input.eventCoverage, 0.5), 0, 1);
    const freshnessScore = this.clamp(this.number(input.freshnessScore, 0.65), 0, 1);
    const volatilityScore = this.clamp(this.number(input.volatilityScore, 0), 0, 1);
    const providerDisagreement = this.clamp(this.number(input.providerDisagreement, 0), 0, 1);
    const missingStatsRatio = this.clamp(this.number(input.missingStatsRatio, 0.35), 0, 1);
    const riskFlagPenalty = this.riskFlagPenalty(input.riskFlags);
    const calibrationSampleFactor = this.clamp(this.number(input.calibrationSampleSize, 0) / 220, 0, 1);
    const calibrationEce =
      input.calibrationEce === null || input.calibrationEce === undefined
        ? null
        : this.clamp(this.number(input.calibrationEce, 0), 0, 1);

    const components = {
      lineupCoverage: (lineupCoverage - 0.5) * weights.lineupCoverage * profile.lineupMultiplier,
      oddsCoverage: (oddsCoverage - 0.5) * weights.oddsCoverage * profile.oddsMultiplier,
      eventCoverage: (eventCoverage - 0.5) * weights.eventCoverage * profile.eventMultiplier,
      freshness: (freshnessScore - 0.5) * weights.freshness,
      volatilityPenalty: -volatilityScore * weights.volatility * profile.volatilityMultiplier,
      providerDisagreementPenalty:
        -providerDisagreement * weights.providerDisagreement * profile.disagreementMultiplier,
      missingStatsPenalty: -missingStatsRatio * weights.missingStatsRatio * profile.missingStatsMultiplier,
      riskFlagPenalty: -riskFlagPenalty * weights.riskFlags,
      calibrationSample: (calibrationSampleFactor - 0.5) * weights.calibrationSample,
      calibrationEcePenalty: -(calibrationEce ?? 0.08) * weights.calibrationEce,
      derivationPenalty: -profile.derivationPenalty
    };
    const adjustment = Object.values(components).reduce((sum, value) => sum + value, 0);
    const adjusted = this.clamp(baselineBlend + adjustment, 0.05, 0.97);

    const diagnostics: ConfidenceDiagnostics = {
      market: input.market,
      marketProfile: profile.profile,
      derivedMarket: profile.derivedMarket,
      rawConfidence: this.round(raw),
      calibrationConfidence: this.round(calibration),
      metaModelConfidence: this.round(meta),
      adjustedConfidence: this.round(adjusted),
      baselineBlend: this.round(baselineBlend),
      signals: {
        lineupCoverage: this.round(lineupCoverage),
        oddsCoverage: this.round(oddsCoverage),
        eventCoverage: this.round(eventCoverage),
        freshnessScore: this.round(freshnessScore),
        volatilityScore: this.round(volatilityScore),
        providerDisagreement: this.round(providerDisagreement),
        missingStatsRatio: this.round(missingStatsRatio),
        riskFlagPenalty: this.round(riskFlagPenalty),
        calibrationSampleFactor: this.round(calibrationSampleFactor),
        calibrationEce: calibrationEce === null ? null : this.round(calibrationEce)
      },
      weights,
      components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, this.round(value)]))
    };

    return {
      confidence: diagnostics.adjustedConfidence,
      diagnostics
    };
  }
}
