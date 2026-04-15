import { Injectable } from "@nestjs/common";
import { expandPredictionMarkets, ExpandedPredictionItem, PredictionRowInput } from "../prediction-markets.util";
import { PredictionSportCode, PredictionSportStrategy } from "./prediction-sport.strategy";

@Injectable()
export class FootballPredictionStrategy implements PredictionSportStrategy {
  readonly sport: PredictionSportCode = "football";

  expand(row: PredictionRowInput): ExpandedPredictionItem[] {
    return expandPredictionMarkets(row);
  }
}

