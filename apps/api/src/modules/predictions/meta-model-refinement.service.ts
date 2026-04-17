import { Injectable } from "@nestjs/common";
import { EventEnrichmentService } from "./event-enrichment.service";
import { LineupSnapshotService } from "./lineup-snapshot.service";
import { MarketConsensusSnapshotService } from "./market-consensus-snapshot.service";

type RefinePredictionInput = {
  matchId: string;
  market: string;
  line: number | null;
  horizon: string;
  cutoffAt: Date;
  selection: string | null;
  coreProbability: number;
  coreConfidence: number;
  lineupSnapshot?: {
    id: string;
    lineupJson: unknown;
    coverageJson: unknown;
  } | null;
  eventSnapshot?: {
    id: string;
    aggregateJson: unknown;
    coverageJson: unknown;
  } | null;
  marketConsensusSnapshot?: {
    id: string;
    consensusJson: unknown;
  } | null;
};

type RefinePredictionResult = {
  source: "core_model" | "odds_meta_model_v1";
  modelVersion: string;
  refinedProbability: number;
  publishScore: number;
  riskAdjustedConfidence: number;
  isFallback: boolean;
  fallbackReason: string | null;
  featureCoverage: Record<string, unknown>;
  details: Record<string, unknown>;
};

@Injectable()
export class MetaModelRefinementService {
  constructor(
    private readonly lineupSnapshotService: LineupSnapshotService,
    private readonly eventEnrichmentService: EventEnrichmentService,
    private readonly marketConsensusSnapshotService: MarketConsensusSnapshotService
  ) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private round(value: number, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private asRecord(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
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

  refine(input: RefinePredictionInput): RefinePredictionResult {
    const coreProbability = this.clamp(input.coreProbability, 0.0001, 0.9999);
    const coreConfidence = this.clamp(input.coreConfidence, 0, 1);

    const lineupSignal = input.lineupSnapshot
      ? this.lineupSnapshotService.scoreLineupSignal(input.lineupSnapshot.lineupJson)
      : 0;
    const eventSignal = input.eventSnapshot
      ? this.eventEnrichmentService.scoreEventSignal(input.eventSnapshot.aggregateJson)
      : 0;
    const marketProbability = input.marketConsensusSnapshot
      ? this.marketConsensusSnapshotService.resolveMarketProbability(
          input.marketConsensusSnapshot.consensusJson,
          input.market,
          input.line,
          input.selection
        )
      : null;

    let marketAdjustment = 0;
    let volatilityPenalty = 0;
    if (input.marketConsensusSnapshot) {
      const consensusRecord = this.asRecord(input.marketConsensusSnapshot.consensusJson);
      const summary = this.asRecord(consensusRecord?.summary);
      const avgSpread = this.asNumber(summary?.avg_bookmaker_spread) ?? 0;
      const avgDriftMagnitude = this.asNumber(summary?.avg_drift_magnitude) ?? 0;
      const suspiciousRows = this.asNumber(summary?.suspicious_volatility_rows) ?? 0;
      const totalRows = this.asNumber(summary?.total_rows) ?? 1;
      const suspiciousRate = totalRows <= 0 ? 0 : suspiciousRows / totalRows;
      volatilityPenalty = this.clamp(avgSpread * 0.7 + avgDriftMagnitude * 0.65 + suspiciousRate * 0.4, 0, 0.35);
      if (marketProbability !== null) {
        const gap = marketProbability - coreProbability;
        marketAdjustment = this.clamp(gap * 0.28, -0.13, 0.13);
      }
    }

    const hasLineup = input.lineupSnapshot !== null && input.lineupSnapshot !== undefined;
    const hasEvent = input.eventSnapshot !== null && input.eventSnapshot !== undefined;
    const hasConsensus = input.marketConsensusSnapshot !== null && input.marketConsensusSnapshot !== undefined;
    const hasMarketProbability = marketProbability !== null;

    if (!hasLineup && !hasEvent && !hasConsensus) {
      return {
        source: "core_model",
        modelVersion: "odds_meta_model_v1",
        refinedProbability: coreProbability,
        publishScore: this.round(this.clamp(coreConfidence, 0, 1), 6),
        riskAdjustedConfidence: this.round(this.clamp(coreConfidence, 0, 1), 6),
        isFallback: true,
        fallbackReason: "enrichment_unavailable",
        featureCoverage: {
          hasLineup: false,
          hasEvent: false,
          hasConsensus: false,
          hasMarketProbability: false
        },
        details: {
          lineupSignal,
          eventSignal,
          marketAdjustment,
          volatilityPenalty
        }
      };
    }

    const refinedProbability = this.clamp(
      coreProbability + lineupSignal * 0.18 + eventSignal * 0.16 + marketAdjustment * 0.9,
      0.0001,
      0.9999
    );
    const adjustedProbability = this.clamp(
      refinedProbability * (1 - volatilityPenalty * 0.18) + coreProbability * volatilityPenalty * 0.18,
      0.0001,
      0.9999
    );

    const edgeStrength = Math.abs(adjustedProbability - 0.5) * 2;
    const coverageBonus =
      (hasLineup ? 0.08 : 0) + (hasEvent ? 0.08 : 0) + (hasConsensus ? 0.1 : 0) + (hasMarketProbability ? 0.04 : 0);
    const publishScore = this.clamp(
      0.26 + coreConfidence * 0.36 + edgeStrength * 0.32 + coverageBonus - volatilityPenalty * 0.45,
      0.05,
      0.98
    );
    const riskAdjustedConfidence = this.clamp(
      coreConfidence * 0.56 + publishScore * 0.44 - volatilityPenalty * 0.35,
      0.05,
      0.98
    );

    return {
      source: "odds_meta_model_v1",
      modelVersion: "odds_meta_model_v1",
      refinedProbability: this.round(adjustedProbability, 6),
      publishScore: this.round(publishScore, 6),
      riskAdjustedConfidence: this.round(riskAdjustedConfidence, 6),
      isFallback: false,
      fallbackReason: null,
      featureCoverage: {
        hasLineup,
        hasEvent,
        hasConsensus,
        hasMarketProbability
      },
      details: {
        lineupSignal: this.round(lineupSignal, 6),
        eventSignal: this.round(eventSignal, 6),
        marketProbability,
        marketAdjustment: this.round(marketAdjustment, 6),
        volatilityPenalty: this.round(volatilityPenalty, 6),
        cutoffAt: input.cutoffAt.toISOString()
      }
    };
  }
}

