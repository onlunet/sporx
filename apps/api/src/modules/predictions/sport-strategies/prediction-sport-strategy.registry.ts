import { Injectable } from "@nestjs/common";
import { BasketballPredictionStrategy } from "./basketball-prediction.strategy";
import { FootballPredictionStrategy } from "./football-prediction.strategy";
import { PredictionSportCode, PredictionSportStrategy } from "./prediction-sport.strategy";

@Injectable()
export class PredictionSportStrategyRegistry {
  private readonly strategyBySport = new Map<PredictionSportCode, PredictionSportStrategy>();

  constructor(
    private readonly footballStrategy: FootballPredictionStrategy,
    private readonly basketballStrategy: BasketballPredictionStrategy
  ) {
    this.strategyBySport.set(this.footballStrategy.sport, this.footballStrategy);
    this.strategyBySport.set(this.basketballStrategy.sport, this.basketballStrategy);
  }

  private parseSportCode(raw?: string | null): PredictionSportCode {
    const normalized = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (normalized === "basketball" || normalized === "nba" || normalized === "basket") {
      return "basketball";
    }
    return "football";
  }

  forSport(raw?: string | null): PredictionSportStrategy {
    const sportCode = this.parseSportCode(raw);
    return this.strategyBySport.get(sportCode) ?? this.footballStrategy;
  }
}

