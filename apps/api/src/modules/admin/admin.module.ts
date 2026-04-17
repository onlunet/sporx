import { Module } from "@nestjs/common";
import { AdminIngestionController } from "./admin-ingestion.controller";
import { AdminImportController } from "./admin-import.controller";
import { AdminProvidersController } from "./admin-providers.controller";
import { AdminModelsController } from "./admin-models.controller";
import { AdminCalibrationController } from "./admin-calibration.controller";
import { AdminBacktestController } from "./admin-backtest.controller";
import { AdminPredictionsController } from "./admin-predictions.controller";
import { AdminFeaturesController } from "./admin-features.controller";
import { AdminSystemController } from "./admin-system.controller";
import { AdminLogsController } from "./admin-logs.controller";
import { AdminUsersController } from "./admin-users.controller";
import { AdminTeamsController } from "./admin-teams.controller";
import { AdminModelLifecycleController } from "./admin-model-lifecycle.controller";
import { AdminBankrollController } from "./admin-bankroll.controller";
import { AdminResearchLabController } from "./admin-research-lab.controller";
import { IngestionModule } from "../ingestion/ingestion.module";
import { HistoricalImportModule } from "../historical-import/historical-import.module";
import { ProvidersModule } from "../providers/providers.module";
import { TeamsModule } from "../teams/teams.module";
import { CalibrationModule } from "../calibration/calibration.module";
import { PredictionsModule } from "../predictions/predictions.module";
import { BankrollModule } from "../bankroll/bankroll.module";
import { ResearchLabModule } from "../research-lab/research-lab.module";

@Module({
  imports: [
    IngestionModule,
    HistoricalImportModule,
    ProvidersModule,
    TeamsModule,
    CalibrationModule,
    PredictionsModule,
    BankrollModule,
    ResearchLabModule
  ],
  controllers: [
    AdminIngestionController,
    AdminImportController,
    AdminProvidersController,
    AdminModelsController,
    AdminCalibrationController,
    AdminBacktestController,
    AdminPredictionsController,
    AdminFeaturesController,
    AdminSystemController,
    AdminLogsController,
    AdminUsersController,
    AdminTeamsController,
    AdminModelLifecycleController,
    AdminBankrollController,
    AdminResearchLabController
  ]
})
export class AdminModule {}
