import { Injectable } from "@nestjs/common";
import { expandPredictionMarkets, ExpandedPredictionItem, PredictionRowInput } from "../prediction-markets.util";
import { PredictionSportCode, PredictionSportStrategy } from "./prediction-sport.strategy";

@Injectable()
export class BasketballPredictionStrategy implements PredictionSportStrategy {
  readonly sport: PredictionSportCode = "basketball";

  expand(row: PredictionRowInput): ExpandedPredictionItem[] {
    // PR-1 scope: keep existing behavior while separating strategy boundaries.
    return expandPredictionMarkets(row);
  }
}

