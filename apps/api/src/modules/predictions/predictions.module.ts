import { Module } from "@nestjs/common";
import { PredictionsController } from "./predictions.controller";
import { PredictionsService } from "./predictions.service";
import { PredictionEngineService } from "./prediction-engine.service";
import { TimeDecayService } from "./time-decay.service";
import { AdvancedEloService } from "./advanced-elo.service";
import { DynamicLambdaService } from "./dynamic-lambda.service";
import { DixonColesService } from "./dixon-coles.service";
import { AdvancedPredictionEngineService } from "./advanced-prediction-engine.service";

@Module({
  controllers: [PredictionsController],
  providers: [
    PredictionsService,
    PredictionEngineService,
    TimeDecayService,
    AdvancedEloService,
    DynamicLambdaService,
    DixonColesService,
    AdvancedPredictionEngineService
  ],
  exports: [
    PredictionsService,
    PredictionEngineService,
    TimeDecayService,
    AdvancedEloService,
    DynamicLambdaService,
    DixonColesService,
    AdvancedPredictionEngineService
  ]
})
export class PredictionsModule {}
