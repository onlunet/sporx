import { Injectable } from "@nestjs/common";

export type DynamicLambdaInput = {
  homeAttack: number;
  awayAttack: number;
  homeDefense: number;
  awayDefense: number;
  eloHome: number;
  eloAway: number;
  homeFormScore: number;
  awayFormScore: number;
  scheduleFatigueScore: number;
  lineupCertaintyScore: number;
  contextPressureScore: number;
  leagueGoalEnvironment: number;
  homeAdvantageMultiplier: number;
  awayPenaltyMultiplier: number;
  baselineAdjustedLambdaHome?: number | null;
  baselineAdjustedLambdaAway?: number | null;
};

export type DynamicLambdaResult = {
  lambdaHome: number;
  lambdaAway: number;
  adjustedLambdaHome: number;
  adjustedLambdaAway: number;
  volatilityScore: number;
};

@Injectable()
export class DynamicLambdaService {
  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private asFinite(value: number | null | undefined, fallback: number) {
    if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) {
      return fallback;
    }
    return value;
  }

  compute(input: DynamicLambdaInput): DynamicLambdaResult {
    const homeAttack = this.clamp(this.asFinite(input.homeAttack, 1), 0.45, 2.6);
    const awayAttack = this.clamp(this.asFinite(input.awayAttack, 1), 0.45, 2.6);
    const homeDefense = this.clamp(this.asFinite(input.homeDefense, 1), 0.45, 2.6);
    const awayDefense = this.clamp(this.asFinite(input.awayDefense, 1), 0.45, 2.6);

    const baseHome = this.clamp(homeAttack * awayDefense, 0.2, 3.4);
    const baseAway = this.clamp(awayAttack * homeDefense, 0.2, 3.4);

    const eloHome = this.asFinite(input.eloHome, 1500);
    const eloAway = this.asFinite(input.eloAway, 1500);
    const eloRatio = this.clamp((eloHome + 1) / (eloAway + 1), 0.72, 1.38);
    const alpha = 0.2;
    const eloMultiplierHome = Math.pow(eloRatio, alpha);
    const eloMultiplierAway = Math.pow(1 / eloRatio, alpha);

    const homeForm = this.clamp(this.asFinite(input.homeFormScore, 0.55), 0, 1.25);
    const awayForm = this.clamp(this.asFinite(input.awayFormScore, 0.55), 0, 1.25);
    const formFactorHome = this.clamp(1 + (homeForm - awayForm) * 0.24, 0.74, 1.26);
    const formFactorAway = this.clamp(1 + (awayForm - homeForm) * 0.24, 0.74, 1.26);

    const fatigue = this.clamp(this.asFinite(input.scheduleFatigueScore, 0.3), 0, 1);
    const fatiguePenaltyHome = this.clamp(1 - fatigue * 0.16, 0.74, 1.02);
    const fatiguePenaltyAway = this.clamp(1 - fatigue * 0.18, 0.7, 1.02);

    const lineupCertainty = this.clamp(this.asFinite(input.lineupCertaintyScore, 0.65), 0.2, 1);
    const lineupMultiplier = this.clamp(0.88 + lineupCertainty * 0.22, 0.82, 1.12);

    const contextPressure = this.clamp(this.asFinite(input.contextPressureScore, 0.5), 0, 1);
    const contextHome = this.clamp(1 + (contextPressure - 0.5) * 0.1, 0.9, 1.1);
    const contextAway = this.clamp(1 - (contextPressure - 0.5) * 0.08, 0.9, 1.1);

    const goalEnvironment = this.clamp(this.asFinite(input.leagueGoalEnvironment, 1), 0.82, 1.22);
    const homeAdvantageMultiplier = this.clamp(this.asFinite(input.homeAdvantageMultiplier, 1.01), 0.95, 1.08);
    const awayPenaltyMultiplier = this.clamp(this.asFinite(input.awayPenaltyMultiplier, 0.995), 0.92, 1.06);

    const lambdaHome = this.clamp(
      baseHome *
        eloMultiplierHome *
        formFactorHome *
        homeAdvantageMultiplier *
        fatiguePenaltyHome *
        lineupMultiplier *
        contextHome *
        goalEnvironment,
      0.2,
      3.9
    );

    const lambdaAway = this.clamp(
      baseAway *
        eloMultiplierAway *
        formFactorAway *
        awayPenaltyMultiplier *
        fatiguePenaltyAway *
        lineupMultiplier *
        contextAway *
        goalEnvironment,
      0.2,
      3.6
    );

    const baselineHome = this.asFinite(input.baselineAdjustedLambdaHome, lambdaHome);
    const baselineAway = this.asFinite(input.baselineAdjustedLambdaAway, lambdaAway);

    const adjustedLambdaHome = this.clamp(lambdaHome * 0.62 + baselineHome * 0.38, 0.2, 3.9);
    const adjustedLambdaAway = this.clamp(lambdaAway * 0.62 + baselineAway * 0.38, 0.2, 3.6);

    const volatilityScore = this.clamp(
      Math.abs(adjustedLambdaHome - adjustedLambdaAway) * 0.22 +
        Math.abs(1 - lineupMultiplier) * 1.3 +
        fatigue * 0.35 +
        (1 - lineupCertainty) * 0.55,
      0,
      1
    );

    return {
      lambdaHome: Number(lambdaHome.toFixed(4)),
      lambdaAway: Number(lambdaAway.toFixed(4)),
      adjustedLambdaHome: Number(adjustedLambdaHome.toFixed(4)),
      adjustedLambdaAway: Number(adjustedLambdaAway.toFixed(4)),
      volatilityScore: Number(volatilityScore.toFixed(4))
    };
  }
}
