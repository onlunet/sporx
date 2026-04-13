import { Injectable } from "@nestjs/common";
import { AdvancedEloService } from "./advanced-elo.service";
import { DixonColesService } from "./dixon-coles.service";
import { DynamicLambdaService } from "./dynamic-lambda.service";
import { PredictionEngineService } from "./prediction-engine.service";
import { TimeDecayService } from "./time-decay.service";

type AdvancedPredictionInput = {
  homeElo: number;
  awayElo: number;
  homeAttack: number;
  awayAttack: number;
  homeDefense: number;
  awayDefense: number;
  form5Home: number | null;
  form5Away: number | null;
  scheduleFatigueScore: number | null;
  lineupCertaintyScore: number | null;
  contextPressureScore: number | null;
  leagueGoalEnvironment: number | null;
  homeAwaySplitStrength: number | null;
  opponentAdjustedStrength: number | null;
  baselineAdjustedLambdaHome: number | null;
  baselineAdjustedLambdaAway: number | null;
  lowScoreBias: number | null;
  riskTuning?: {
    lowScoreBiasThreshold?: number;
    lowScoreTotalGoalsThreshold?: number;
    conflictBaseEloGap?: number;
    conflictLeagueGoalEnvMultiplier?: number;
    conflictVolatilityMultiplier?: number;
    conflictOutcomeEdgeBase?: number;
    conflictOutcomeEdgeVolatilityMultiplier?: number;
    conflictMinCalibratedConfidence?: number;
  };
  kickoffAt: Date;
  now: Date;
};

type AdvancedPredictionResult = {
  rawProbabilities: { home: number; draw: number; away: number };
  calibratedProbabilities: { home: number; draw: number; away: number };
  rawConfidenceScore: number;
  calibratedConfidenceScore: number;
  lambdaHome: number;
  lambdaAway: number;
  adjustedLambdaHome: number;
  adjustedLambdaAway: number;
  eloHome: number;
  eloAway: number;
  scoreMatrixTop: Array<{ home: number; away: number; probability: number }>;
  lowScoreBiasApplied: boolean;
  instabilityScore: number;
  advancedRiskFlags: Array<{ code: string; severity: string; message: string }>;
};

@Injectable()
export class AdvancedPredictionEngineService {
  constructor(
    private readonly predictionEngine: PredictionEngineService,
    private readonly timeDecay: TimeDecayService,
    private readonly advancedElo: AdvancedEloService,
    private readonly dynamicLambda: DynamicLambdaService,
    private readonly dixonColes: DixonColesService
  ) {}

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private normalizeForm(value: number | null | undefined) {
    if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
      return 0.55;
    }
    if (value >= 0 && value <= 1.2) {
      return this.clamp(value, 0, 1.2);
    }
    if (value >= 0 && value <= 5) {
      return this.clamp(value / 5, 0, 1.2);
    }
    if (value > 5 && value <= 15) {
      return this.clamp(value / 15, 0, 1.2);
    }
    return this.clamp(value / 100, 0, 1.2);
  }

  private numeric(value: number | null | undefined, fallback: number) {
    if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
      return fallback;
    }
    return value;
  }

  compute(input: AdvancedPredictionInput): AdvancedPredictionResult {
    const homeFormScore = this.normalizeForm(input.form5Home);
    const awayFormScore = this.normalizeForm(input.form5Away);

    const daysToKickoff = Math.max(0, (input.kickoffAt.getTime() - input.now.getTime()) / (24 * 60 * 60 * 1000));
    const recencyWeight = this.timeDecay.weight(Math.min(daysToKickoff, 14), 0.08);

    const eloResult = this.advancedElo.compute({
      homeElo: input.homeElo,
      awayElo: input.awayElo,
      homeFormScore,
      awayFormScore,
      homeAwaySplitStrength: this.numeric(input.homeAwaySplitStrength, 0.5),
      opponentAdjustedStrength: this.numeric(input.opponentAdjustedStrength, 0.5),
      scheduleFatigueScore: this.numeric(input.scheduleFatigueScore, 0.3),
      volatilityScore: Math.abs(homeFormScore - awayFormScore)
    });

    const lambdaResult = this.dynamicLambda.compute({
      homeAttack: input.homeAttack,
      awayAttack: input.awayAttack,
      homeDefense: input.homeDefense,
      awayDefense: input.awayDefense,
      eloHome: eloResult.eloHome,
      eloAway: eloResult.eloAway,
      homeFormScore,
      awayFormScore,
      scheduleFatigueScore: this.numeric(input.scheduleFatigueScore, 0.3),
      lineupCertaintyScore: this.numeric(input.lineupCertaintyScore, 0.65),
      contextPressureScore: this.numeric(input.contextPressureScore, 0.5),
      leagueGoalEnvironment: this.numeric(input.leagueGoalEnvironment, 1),
      homeAdvantageMultiplier: 1.01 + recencyWeight * 0.005,
      awayPenaltyMultiplier: 0.995 + recencyWeight * 0.005,
      baselineAdjustedLambdaHome: input.baselineAdjustedLambdaHome,
      baselineAdjustedLambdaAway: input.baselineAdjustedLambdaAway
    });

    const matrix = this.dixonColes.buildCorrectedMatrix(
      lambdaResult.adjustedLambdaHome,
      lambdaResult.adjustedLambdaAway,
      -0.06,
      7
    );

    const rawProbabilities = this.dixonColes.outcomeProbabilities(matrix);
    const calibratedProbabilities = this.predictionEngine.calibrate(rawProbabilities, 0.98);
    const rawConfidenceScore = this.predictionEngine.confidence(rawProbabilities);
    const calibratedConfidenceScore = this.predictionEngine.confidence(calibratedProbabilities);

    const lowScoreBias = this.numeric(input.lowScoreBias, 0);
    const totalGoalsExpectation = lambdaResult.adjustedLambdaHome + lambdaResult.adjustedLambdaAway;
    const riskTuning = input.riskTuning ?? {};
    const lowScoreBiasThreshold = this.numeric(riskTuning.lowScoreBiasThreshold, 0.18);
    const lowScoreTotalGoalsThreshold = this.numeric(riskTuning.lowScoreTotalGoalsThreshold, 1.6);
    const lowScoreBiasApplied = lowScoreBias > lowScoreBiasThreshold || totalGoalsExpectation < lowScoreTotalGoalsThreshold;

    const scoreMatrixTop = [...matrix]
      .sort((left, right) => right.probability - left.probability)
      .slice(0, 12)
      .map((item) => ({
        home: item.home,
        away: item.away,
        probability: Number(item.probability.toFixed(4))
      }));

    const advancedRiskFlags: Array<{ code: string; severity: string; message: string }> = [];
    if (lowScoreBiasApplied) {
      advancedRiskFlags.push({
        code: "LOW_SCORE_BIAS",
        severity: "low",
        message: "Dusuk skorlu senaryolarda sapma olasiligi yuksek."
      });
    }
    if (lambdaResult.adjustedLambdaHome > 3.2 || lambdaResult.adjustedLambdaAway > 3.1 || lambdaResult.adjustedLambdaHome < 0.35 || lambdaResult.adjustedLambdaAway < 0.35) {
      advancedRiskFlags.push({
        code: "UNSTABLE_LAMBDA",
        severity: "medium",
        message: "Dynamic lambda dagilimi istikrarsiz bolgede."
      });
    }
    if (lambdaResult.volatilityScore >= 0.72) {
      advancedRiskFlags.push({
        code: "HIGH_VARIANCE_MATCH",
        severity: "medium",
        message: "Mac varyansi yuksek, olasiliklar hizla degisebilir."
      });
    }

    const outcomeSide = rawProbabilities.home >= rawProbabilities.away ? "home" : "away";
    const eloSide = eloResult.eloGap >= 0 ? "home" : "away";
    const outcomeEdge = Math.abs(rawProbabilities.home - rawProbabilities.away);
    const leagueGoalEnvironment = this.numeric(input.leagueGoalEnvironment, 1);
    const conflictBaseEloGap = this.numeric(riskTuning.conflictBaseEloGap, 45);
    const conflictLeagueGoalEnvMultiplier = this.numeric(riskTuning.conflictLeagueGoalEnvMultiplier, 20);
    const conflictVolatilityMultiplier = this.numeric(riskTuning.conflictVolatilityMultiplier, 25);
    const conflictOutcomeEdgeBase = this.numeric(riskTuning.conflictOutcomeEdgeBase, 0.11);
    const conflictOutcomeEdgeVolatilityMultiplier = this.numeric(
      riskTuning.conflictOutcomeEdgeVolatilityMultiplier,
      0.12
    );
    const conflictMinCalibratedConfidence = this.numeric(riskTuning.conflictMinCalibratedConfidence, 0.56);
    const dynamicEloGapThreshold =
      conflictBaseEloGap +
      this.clamp((leagueGoalEnvironment - 1) * conflictLeagueGoalEnvMultiplier, -6, 12) +
      this.clamp((lambdaResult.volatilityScore - 0.6) * conflictVolatilityMultiplier, -5, 12);
    const outcomeEdgeThreshold = this.clamp(
      conflictOutcomeEdgeBase +
        this.clamp(lambdaResult.volatilityScore - 0.6, -0.15, 0.2) * conflictOutcomeEdgeVolatilityMultiplier,
      0.09,
      0.16
    );
    if (
      outcomeSide !== eloSide &&
      Math.abs(eloResult.eloGap) >= dynamicEloGapThreshold &&
      outcomeEdge >= outcomeEdgeThreshold &&
      calibratedConfidenceScore >= conflictMinCalibratedConfidence
    ) {
      advancedRiskFlags.push({
        code: "CONFLICTING_SIGNALS",
        severity: "medium",
        message: "Elo ve gol dagilimi sinyalleri farkli yon gosteriyor."
      });
    }

    return {
      rawProbabilities,
      calibratedProbabilities,
      rawConfidenceScore,
      calibratedConfidenceScore,
      lambdaHome: lambdaResult.lambdaHome,
      lambdaAway: lambdaResult.lambdaAway,
      adjustedLambdaHome: lambdaResult.adjustedLambdaHome,
      adjustedLambdaAway: lambdaResult.adjustedLambdaAway,
      eloHome: eloResult.eloHome,
      eloAway: eloResult.eloAway,
      scoreMatrixTop,
      lowScoreBiasApplied,
      instabilityScore: lambdaResult.volatilityScore,
      advancedRiskFlags
    };
  }
}
