import { Injectable } from "@nestjs/common";
import { FootballComparisonStrategy } from "./football-comparison.strategy";
import { TeamComparisonSportCode, TeamComparisonStrategy, TeamComparisonStrategyInput } from "./team-comparison.strategy";

@Injectable()
export class BasketballComparisonStrategy implements TeamComparisonStrategy {
  readonly sport: TeamComparisonSportCode = "basketball";

  constructor(private readonly footballComparisonStrategy: FootballComparisonStrategy) {}

  async compare(input: TeamComparisonStrategyInput) {
    // PR-1 scope: strategy boundary is separated while preserving existing comparison behavior.
    return this.footballComparisonStrategy.compare(input);
  }
}

