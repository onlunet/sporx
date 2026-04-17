import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
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
import { FeatureSnapshotService } from "./feature-snapshot.service";
import { TrainingExampleBuilderService } from "./training-example-builder.service";
import { ShadowEvaluationService } from "./shadow-evaluation.service";
import { PipelineRolloutService } from "./pipeline-rollout.service";
import { EnrichmentFlagsService } from "./enrichment-flags.service";
import { LineupSnapshotService } from "./lineup-snapshot.service";
import { EventEnrichmentService } from "./event-enrichment.service";
import { MarketConsensusSnapshotService } from "./market-consensus-snapshot.service";
import { MetaModelRefinementService } from "./meta-model-refinement.service";
import { SelectionEngineConfigService } from "./selection-engine-config.service";
import { CandidateBuilderService } from "./candidate-builder.service";
import { SelectionScoreService } from "./selection-score.service";
import { AbstainPolicyService } from "./abstain-policy.service";
import { ConflictResolutionService } from "./conflict-resolution.service";
import { PublishDecisionService } from "./publish-decision.service";
import { ModelAliasService } from "./model-alias.service";
import { TrainingDatasetBuilderService } from "./training-dataset-builder.service";
import { ChallengerEvaluationService } from "./challenger-evaluation.service";
import { PromotionDecisionService } from "./promotion-decision.service";
import { RollbackDecisionService } from "./rollback-decision.service";
import { DriftMonitoringService } from "./drift-monitoring.service";
import { RetrainingTriggerService } from "./retraining-trigger.service";
import { ModelLifecycleOrchestrationService } from "./model-lifecycle-orchestration.service";

@Module({
  imports: [
    OddsModule,
    BullModule.registerQueue({
      name: "model-lifecycle"
    })
  ],
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
    BasketballPredictionEngineService,
    FeatureSnapshotService,
    TrainingExampleBuilderService,
    ShadowEvaluationService,
    PipelineRolloutService,
    EnrichmentFlagsService,
    LineupSnapshotService,
    EventEnrichmentService,
    MarketConsensusSnapshotService,
    MetaModelRefinementService,
    SelectionEngineConfigService,
    CandidateBuilderService,
    SelectionScoreService,
    AbstainPolicyService,
    ConflictResolutionService,
    PublishDecisionService,
    ModelAliasService,
    TrainingDatasetBuilderService,
    ChallengerEvaluationService,
    PromotionDecisionService,
    RollbackDecisionService,
    DriftMonitoringService,
    RetrainingTriggerService,
    ModelLifecycleOrchestrationService
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
    BasketballPredictionEngineService,
    FeatureSnapshotService,
    TrainingExampleBuilderService,
    ShadowEvaluationService,
    PipelineRolloutService,
    EnrichmentFlagsService,
    LineupSnapshotService,
    EventEnrichmentService,
    MarketConsensusSnapshotService,
    MetaModelRefinementService,
    SelectionEngineConfigService,
    CandidateBuilderService,
    SelectionScoreService,
    AbstainPolicyService,
    ConflictResolutionService,
    PublishDecisionService,
    ModelAliasService,
    TrainingDatasetBuilderService,
    ChallengerEvaluationService,
    PromotionDecisionService,
    RollbackDecisionService,
    DriftMonitoringService,
    RetrainingTriggerService,
    ModelLifecycleOrchestrationService
  ]
})
export class PredictionsModule {}
