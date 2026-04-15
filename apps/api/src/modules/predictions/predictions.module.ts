import { Module } from "@nestjs/common";
import { PredictionsController } from "./predictions.controller";
import { PredictionsService } from "./predictions.service";
import { PredictionEngineService } from "./prediction-engine.service";
import { TimeDecayService } from "./time-decay.service";
import { AdvancedEloService } from "./advanced-elo.service";
import { DynamicLambdaService } from "./dynamic-lambda.service";
import { DixonColesService } from "./dixon-coles.service";
import { AdvancedPredictionEngineService } from "./advanced-prediction-engine.service";
import { OddsModule } from "../odds/odds.module";
import { FootballPredictionStrategy } from "./sport-strategies/football-prediction.strategy";
import { BasketballPredictionStrategy } from "./sport-strategies/basketball-prediction.strategy";
import { PredictionSportStrategyRegistry } from "./sport-strategies/prediction-sport-strategy.registry";

@Module({
  imports: [OddsModule],
  controllers: [PredictionsController],
  providers: [
    PredictionsService,
    PredictionEngineService,
    TimeDecayService,
    AdvancedEloService,
    DynamicLambdaService,
    DixonColesService,
    AdvancedPredictionEngineService,
    FootballPredictionStrategy,
    BasketballPredictionStrategy,
    PredictionSportStrategyRegistry
  ],
  exports: [
    PredictionsService,
    PredictionEngineService,
    TimeDecayService,
    AdvancedEloService,
    DynamicLambdaService,
    DixonColesService,
    AdvancedPredictionEngineService,
    PredictionSportStrategyRegistry
  ]
})
export class PredictionsModule {}
