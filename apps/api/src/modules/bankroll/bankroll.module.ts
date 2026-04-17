import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { BankrollConfigService } from "./bankroll-config.service";
import { StakeCandidateBuilderService } from "./stake-candidate-builder.service";
import { StakeSizingService } from "./stake-sizing.service";
import { ExposureCheckService } from "./exposure-check.service";
import { CorrelationCheckService } from "./correlation-check.service";
import { TicketConstructionService } from "./ticket-construction.service";
import { PaperExecutionService } from "./paper-execution.service";
import { SettlementService } from "./settlement.service";
import { BankrollAccountingService } from "./bankroll-accounting.service";
import { SimulationService } from "./simulation.service";
import { RoiGovernanceService } from "./roi-governance.service";
import { BankrollOrchestrationService } from "./bankroll-orchestration.service";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "bankroll"
    })
  ],
  providers: [
    BankrollConfigService,
    StakeCandidateBuilderService,
    StakeSizingService,
    ExposureCheckService,
    CorrelationCheckService,
    TicketConstructionService,
    PaperExecutionService,
    SettlementService,
    BankrollAccountingService,
    SimulationService,
    RoiGovernanceService,
    BankrollOrchestrationService
  ],
  exports: [
    BankrollConfigService,
    StakeSizingService,
    ExposureCheckService,
    CorrelationCheckService,
    TicketConstructionService,
    SettlementService,
    BankrollAccountingService,
    SimulationService,
    RoiGovernanceService,
    BankrollOrchestrationService
  ]
})
export class BankrollModule {}
