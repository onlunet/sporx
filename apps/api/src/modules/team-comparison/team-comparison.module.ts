import { Module } from "@nestjs/common";
import { TeamComparisonController } from "./team-comparison.controller";
import { TeamComparisonService } from "./team-comparison.service";
import { TeamFeatureAggregationService } from "./team-feature-aggregation.service";
import { TeamStrengthService } from "./team-strength.service";
import { ProxyXGService } from "./proxy-xg.service";
import { ComparisonEngineService } from "./comparison-engine.service";
import { ScenarioEngineService } from "./scenario-engine.service";
import { ExplanationEngineService } from "./explanation-engine.service";
import { ComparisonConfidenceService } from "./comparison-confidence.service";
import { TeamsModule } from "../teams/teams.module";
import { FootballComparisonStrategy } from "./sport-strategies/football-comparison.strategy";
import { BasketballComparisonStrategy } from "./sport-strategies/basketball-comparison.strategy";
import { TeamComparisonStrategyRegistry } from "./sport-strategies/team-comparison-strategy.registry";

@Module({
  imports: [TeamsModule],
  controllers: [TeamComparisonController],
  providers: [
    TeamComparisonService,
    TeamFeatureAggregationService,
    TeamStrengthService,
    ProxyXGService,
    ComparisonEngineService,
    ScenarioEngineService,
    ExplanationEngineService,
    ComparisonConfidenceService,
    FootballComparisonStrategy,
    BasketballComparisonStrategy,
    TeamComparisonStrategyRegistry
  ],
  exports: [TeamComparisonService]
})
export class TeamComparisonModule {}
