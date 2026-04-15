import { Module } from "@nestjs/common";
import { BasketballPredictionsController } from "./basketball-predictions.controller";
import { PredictionsController } from "./predictions.controller";
import { PredictionsService } from "./predictions.service";
import { PredictionEngineService } from "./prediction-engine.service";
import { TimeDecayService } from "./time-decay.service";
import { AdvancedEloService } from "./advanced-elo.service";
import { DynamicLambdaService } from "./dynamic-lambda.service";
import { DixonColesService } from "./dixon-coles.service";
import { AdvancedPredictionEngineService } from "./advanced-prediction-engine.service";
import { BasketballCalibrationService } from "./basketball/basketball-calibration.service";
import { BasketballEnsembleService } from "./basketball/basketball-ensemble.service";
import { BasketballFeatureEngineeringService } from "./basketball/basketball-feature-engineering.service";
import { BasketballMarketAdjustmentService } from "./basketball/basketball-market-adjustment.service";
import { BasketballPossessionModelService } from "./basketball/basketball-possession-model.service";
import { BasketballPredictionEngineService } from "./basketball/basketball-prediction-engine.service";
import { BasketballRatingModelService } from "./basketball/basketball-rating-model.service";
import { OddsModule } from "../odds/odds.module";
import { FootballPredictionStrategy } from "./sport-strategies/football-prediction.strategy";
import { BasketballPredictionStrategy } from "./sport-strategies/basketball-prediction.strategy";
import { PredictionSportStrategyRegistry } from "./sport-strategies/prediction-sport-strategy.registry";

@Module({
  imports: [OddsModule],
  controllers: [PredictionsController, BasketballPredictionsController],
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
    PredictionSportStrategyRegistry,
    BasketballFeatureEngineeringService,
    BasketballPossessionModelService,
    BasketballRatingModelService,
    BasketballMarketAdjustmentService,
    BasketballEnsembleService,
    BasketballCalibrationService,
    BasketballPredictionEngineService
  ],
  exports: [
    PredictionsService,
    PredictionEngineService,
    TimeDecayService,
    AdvancedEloService,
    DynamicLambdaService,
    DixonColesService,
    AdvancedPredictionEngineService,
    PredictionSportStrategyRegistry,
    BasketballPredictionEngineService
  ]
})
export class PredictionsModule {}
