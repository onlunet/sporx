import { Injectable } from "@nestjs/common";
import { BasketballComparisonStrategy } from "./basketball-comparison.strategy";
import { FootballComparisonStrategy } from "./football-comparison.strategy";
import { TeamComparisonSportCode, TeamComparisonStrategy } from "./team-comparison.strategy";

@Injectable()
export class TeamComparisonStrategyRegistry {
  private readonly strategyBySport = new Map<TeamComparisonSportCode, TeamComparisonStrategy>();

  constructor(
    private readonly footballStrategy: FootballComparisonStrategy,
    private readonly basketballStrategy: BasketballComparisonStrategy
  ) {
    this.strategyBySport.set(this.footballStrategy.sport, this.footballStrategy);
    this.strategyBySport.set(this.basketballStrategy.sport, this.basketballStrategy);
  }

  private parseSport(raw?: string): TeamComparisonSportCode {
    const normalized = String(raw ?? "")
      .trim()
      .toLowerCase();
    if (normalized === "basketball" || normalized === "nba" || normalized === "basket") {
      return "basketball";
    }
    return "football";
  }

  forSport(raw?: string): TeamComparisonStrategy {
    const sport = this.parseSport(raw);
    return this.strategyBySport.get(sport) ?? this.footballStrategy;
  }
}

