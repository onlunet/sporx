import { Injectable } from "@nestjs/common";

type AxisInput = {
  key: string;
  homeValue: number;
  awayValue: number;
  advantage: "home" | "away" | "neutral";
};

type ConfidenceContext = {
  homeSampleSize: number;
  awaySampleSize: number;
  fallbackUsed: boolean;
};

@Injectable()
export class BasketballComparisonConfidenceService {
  private readonly axisWeights: Record<string, number> = {
    shotQualityCreation: 0.9,
    halfCourtOffense: 1.0,
    transitionOffense: 0.85,
    rimPressure: 0.85,
    perimeterShotProfile: 0.75,
    turnoverControl: 0.9,
    offensiveRebounding: 0.8,
    defensiveRebounding: 0.8,
    rimDefense: 0.9,
    perimeterDefense: 0.9,
    foulDiscipline: 0.6,
    benchImpact: 0.6,
    starPowerReliability: 0.85,
    paceControl: 0.55,
    clutchStability: 0.75,
    scheduleFreshness: 0.7,
    overall: 1.2
  };

  compute(axes: AxisInput[], context: ConfidenceContext) {
    if (axes.length === 0) {
      return 0.2;
    }

    const weighted = axes.reduce(
      (acc, axis) => {
        const weight = this.axisWeights[axis.key] ?? 0.7;
        acc.totalWeight += weight;
        acc.weightedDelta += Math.abs(axis.homeValue - axis.awayValue) * weight;
        return acc;
      },
      { weightedDelta: 0, totalWeight: 0 }
    );

    const weightedDelta = weighted.totalWeight > 0 ? weighted.weightedDelta / weighted.totalWeight : 0;
    const directionalRatio =
      axes.filter((axis) => axis.advantage !== "neutral").length / Math.max(1, axes.length);
    const minSample = Math.min(context.homeSampleSize, context.awaySampleSize);
    const sampleFactor = Math.min(1, Math.sqrt(minSample / 14));
    const fallbackPenalty = context.fallbackUsed ? 0.09 : 0;

    const score =
      0.33 +
      Math.min(1, weightedDelta) * 0.4 +
      directionalRatio * 0.12 +
      sampleFactor * 0.15 -
      fallbackPenalty;
    return Number(Math.min(0.94, Math.max(0.24, score)).toFixed(4));
  }
}
