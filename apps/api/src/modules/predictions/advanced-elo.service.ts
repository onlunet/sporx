import { Injectable } from "@nestjs/common";

export type AdvancedEloInput = {
  homeElo: number;
  awayElo: number;
  homeFormScore: number;
  awayFormScore: number;
  homeAwaySplitStrength: number;
  opponentAdjustedStrength: number;
  scheduleFatigueScore: number;
  volatilityScore: number;
};

export type AdvancedEloResult = {
  eloHome: number;
  eloAway: number;
  eloGap: number;
  dynamicK: number;
};

@Injectable()
export class AdvancedEloService {
  private readonly homeAdvantage = 16;
  private readonly baseKFactor = 20;

  private clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  private asScore(value: number, fallback: number) {
    if (!Number.isFinite(value)) {
      return fallback;
    }
    return this.clamp(value, 0, 1.4);
  }

  compute(input: AdvancedEloInput): AdvancedEloResult {
    const homeBase = Number.isFinite(input.homeElo) ? input.homeElo : 1500;
    const awayBase = Number.isFinite(input.awayElo) ? input.awayElo : 1500;

    const homeForm = this.asScore(input.homeFormScore, 0.55);
    const awayForm = this.asScore(input.awayFormScore, 0.55);
    const formDelta = (homeForm - awayForm) * 95;

    const splitStrength = this.asScore(input.homeAwaySplitStrength, 0.5);
    const splitAdjustment = (splitStrength - 0.5) * 70;

    const opponentAdjustedStrength = this.asScore(input.opponentAdjustedStrength, 0.5);
    const opponentAdjustment = (opponentAdjustedStrength - 0.5) * 60;

    const fatigue = this.asScore(input.scheduleFatigueScore, 0.3);
    const fatiguePenalty = fatigue * 26;

    const volatility = this.asScore(input.volatilityScore, 0.45);
    const dynamicK = Number((this.baseKFactor + volatility * 18).toFixed(2));

    const eloHome = Number((homeBase + this.homeAdvantage + formDelta + splitAdjustment + opponentAdjustment - fatiguePenalty).toFixed(2));
    const eloAway = Number((awayBase - formDelta * 0.55 - splitAdjustment * 0.35 - opponentAdjustment * 0.35 + fatiguePenalty * 0.4).toFixed(2));

    return {
      eloHome,
      eloAway,
      eloGap: Number((eloHome - eloAway).toFixed(2)),
      dynamicK
    };
  }
}
