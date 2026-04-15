import { Injectable } from "@nestjs/common";
import { expandBasketballPredictionMarkets } from "../basketball-prediction-markets.util";
import { ExpandedPredictionItem, PredictionRowInput } from "../prediction-markets.util";
import { PredictionSportCode, PredictionSportStrategy } from "./prediction-sport.strategy";

@Injectable()
export class BasketballPredictionStrategy implements PredictionSportStrategy {
  readonly sport: PredictionSportCode = "basketball";

  expand(row: PredictionRowInput): ExpandedPredictionItem[] {
    return expandBasketballPredictionMarkets(row);
  }
}
