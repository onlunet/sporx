import { Global, Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { ComplianceGovernanceService } from "./compliance-governance.service";
import { DataClassificationService } from "./data-classification.service";
import { DataMinimizationService } from "./data-minimization.service";
import { PrivacyRequestService } from "./privacy-request.service";
import { RetentionGovernanceService } from "./retention-governance.service";

@Global()
@Module({
  imports: [
    BullModule.registerQueue({
      name: "privacy-governance"
    })
  ],
  providers: [
    DataClassificationService,
    DataMinimizationService,
    ComplianceGovernanceService,
    RetentionGovernanceService,
    PrivacyRequestService
  ],
  exports: [
    DataClassificationService,
    DataMinimizationService,
    ComplianceGovernanceService,
    RetentionGovernanceService,
    PrivacyRequestService
  ]
})
export class PrivacyGovernanceModule {}

