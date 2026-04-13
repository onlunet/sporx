import { Injectable } from "@nestjs/common";

@Injectable()
export class MarketAwarePredictionService {
  private readWeight(key: string, fallback: number) {
    const raw = process.env[key];
    if (!raw) {
      return fallback;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 0) {
      return fallback;
    }
    return value;
  }

  private round4(value: number) {
    return Number(value.toFixed(4));
  }

  private normalize(probabilities: Record<string, number>) {
    const entries = Object.entries(probabilities).map(([key, value]) => [key, Math.max(0, value)] as const);
    const sum = entries.reduce((acc, [, value]) => acc + value, 0);
    if (sum <= 0) {
      return Object.fromEntries(entries.map(([key]) => [key, 0]));
    }

    // Keep deterministic 4-decimal probabilities while preserving exact total as 1.0.
    const normalized = entries.map(([key, value]) => [key, value / sum] as const);
    const rounded = normalized.map(([key, value]) => [key, this.round4(value)] as const);
    const roundedSum = rounded.reduce((acc, [, value]) => acc + value, 0);
    const correction = this.round4(1 - roundedSum);

    if (Math.abs(correction) > 0 && rounded.length > 0) {
      const [lastKey, lastValue] = rounded[rounded.length - 1];
      rounded[rounded.length - 1] = [lastKey, this.round4(Math.max(0, lastValue + correction))];
    }

    return Object.fromEntries(rounded);
  }

  blend(
    modelProbabilities: Record<string, number>,
    marketProbabilities: Record<string, number> | null,
    contradictionScore: number
  ) {
    if (!marketProbabilities) {
      return this.normalize(modelProbabilities);
    }

    const coreWeight = this.readWeight("MARKET_BLEND_CORE_WEIGHT", 0.8);
    const marketWeight = this.readWeight("MARKET_BLEND_MARKET_WEIGHT", 0.2);
    const disagreementPenaltyWeight = this.readWeight("MARKET_BLEND_DISAGREEMENT_PENALTY_WEIGHT", 0.35);
    const penalty = Math.max(0, 1 - contradictionScore * disagreementPenaltyWeight);
    const effectiveMarketWeight = marketWeight * penalty;

    const keys = new Set([...Object.keys(modelProbabilities), ...Object.keys(marketProbabilities)]);
    const blended: Record<string, number> = {};

    for (const key of keys) {
      const modelValue = Number(modelProbabilities[key] ?? 0);
      const marketValue = Number(marketProbabilities[key] ?? modelValue);
      blended[key] = modelValue * coreWeight + marketValue * effectiveMarketWeight;
    }

    return this.normalize(blended);
  }

  marketAdjustedConfidence(baseConfidence: number, contradictionScore: number, freshnessScore: number) {
    const confidencePenaltyWeight = this.readWeight("MARKET_BLEND_CONFIDENCE_PENALTY_WEIGHT", 0.28);
    const penalty = contradictionScore * confidencePenaltyWeight;
    const freshnessBoost = (freshnessScore - 0.5) * 0.1;
    const adjusted = baseConfidence - penalty + freshnessBoost;
    return this.round4(Math.max(0.05, Math.min(0.99, adjusted)));
  }
}
