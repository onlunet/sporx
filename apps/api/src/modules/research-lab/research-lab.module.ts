import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ResearchLabConfigService } from "./research-lab-config.service";
import { TimeOrderedEvaluationService } from "./time-ordered-evaluation.service";
import { TuningEngineService } from "./tuning-engine.service";
import { ObjectiveFunctionService } from "./objective-function.service";
import { TrialPruningService } from "./trial-pruning.service";
import { RobustnessCheckService } from "./robustness-check.service";
import { SegmentScorecardService } from "./segment-scorecard.service";
import { ExperimentTrackingService } from "./experiment-tracking.service";
import { PolicyCandidateRegistryService } from "./policy-candidate-registry.service";
import { PolicyPromotionGateService } from "./policy-promotion-gate.service";
import { ResearchLabOrchestrationService } from "./research-lab-orchestration.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "research-lab"
    })
  ],
  providers: [
    ResearchLabConfigService,
    TimeOrderedEvaluationService,
    TuningEngineService,
    ObjectiveFunctionService,
    TrialPruningService,
    RobustnessCheckService,
    SegmentScorecardService,
    ExperimentTrackingService,
    PolicyCandidateRegistryService,
    PolicyPromotionGateService,
    ResearchLabOrchestrationService
  ],
  exports: [
    ResearchLabConfigService,
    TimeOrderedEvaluationService,
    TuningEngineService,
    ObjectiveFunctionService,
    TrialPruningService,
    RobustnessCheckService,
    SegmentScorecardService,
    ExperimentTrackingService,
    PolicyCandidateRegistryService,
    PolicyPromotionGateService,
    ResearchLabOrchestrationService
  ]
})
export class ResearchLabModule {}
