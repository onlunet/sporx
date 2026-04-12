import { Injectable } from "@nestjs/common";

type AxisInput = {
  key?: string;
  homeValue: number;
  awayValue: number;
  advantage?: "home" | "away" | "neutral";
};

type ConfidenceContext = {
  homeSampleSize?: number;
  awaySampleSize?: number;
  fallbackUsed?: boolean;
};

@Injectable()
export class ComparisonConfidenceService {
  private readonly axisWeights: Record<string, number> = {
    offense: 1.05,
    defense: 1.05,
    tempo: 0.75,
    setPiece: 0.65,
    transition: 0.65,
    cohesion: 0.7,
    overall: 1.2
  };

  compute(axes: AxisInput[], context?: ConfidenceContext) {
    if (axes.length === 0) {
      return 0;
    }

    const weighted = axes.reduce(
      (acc, axis) => {
        const weight = this.axisWeights[axis.key ?? ""] ?? 0.8;
        acc.totalWeight += weight;
        acc.weightedDelta += Math.abs(axis.homeValue - axis.awayValue) * weight;
        return acc;
      },
      { weightedDelta: 0, totalWeight: 0 }
    );

    const weightedDelta = weighted.totalWeight > 0 ? weighted.weightedDelta / weighted.totalWeight : 0;
    const directionalAxes = axes.filter((axis) => axis.advantage && axis.advantage !== "neutral");
    const directionalRatio = directionalAxes.length / Math.max(1, axes.length);
    const minSample = Math.min(context?.homeSampleSize ?? 0, context?.awaySampleSize ?? 0);
    const sampleFactor = Math.min(1, Math.sqrt(minSample / 12));
    const fallbackPenalty = context?.fallbackUsed ? 0.08 : 0;

    const score =
      0.35 +
      Math.min(1, weightedDelta) * 0.45 +
      directionalRatio * 0.12 +
      sampleFactor * 0.08 -
      fallbackPenalty;

    return Number(Math.min(0.95, Math.max(0.2, score)).toFixed(4));
  }
}
