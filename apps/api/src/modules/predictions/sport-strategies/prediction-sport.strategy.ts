import { ExpandedPredictionItem, PredictionRowInput } from "../prediction-markets.util";

export type PredictionSportCode = "football" | "basketball";

export interface PredictionSportStrategy {
  readonly sport: PredictionSportCode;
  expand(row: PredictionRowInput): ExpandedPredictionItem[];
}

