import { Injectable } from "@nestjs/common";
import { MarketAnalysisResult, MarketOddsSummary } from "./odds-types";

@Injectable()
export class MarketComparisonService {
  private round4(value: number) {
    return Number(value.toFixed(4));
  }

  compare(modelProbability: number, marketSummary: MarketOddsSummary): MarketAnalysisResult {
    const safeModel = Math.max(0, Math.min(1, modelProbability));
    const safeMarket = Math.max(0, Math.min(1, marketSummary.marketImpliedProbability));
    const probabilityGap = safeModel - safeMarket;
    const contradictionScore = Math.abs(probabilityGap) * (1 + marketSummary.volatilityScore * 2);

    return {
      modelProbability: this.round4(safeModel),
      marketImpliedProbability: this.round4(safeMarket),
      fairMarketProbability:
        marketSummary.fairMarketProbability === null
          ? null
          : this.round4(Math.max(0, Math.min(1, marketSummary.fairMarketProbability))),
      probabilityGap: this.round4(probabilityGap),
      movementDirection: marketSummary.movementDirection,
      volatilityScore: this.round4(marketSummary.volatilityScore),
      consensusScore: this.round4(marketSummary.consensusScore),
      contradictionScore: this.round4(contradictionScore)
    };
  }
}
