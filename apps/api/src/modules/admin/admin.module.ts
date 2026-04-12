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
import { IngestionModule } from "../ingestion/ingestion.module";
import { HistoricalImportModule } from "../historical-import/historical-import.module";
import { ProvidersModule } from "../providers/providers.module";
import { TeamsModule } from "../teams/teams.module";

@Module({
  imports: [IngestionModule, HistoricalImportModule, ProvidersModule, TeamsModule],
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
    AdminTeamsController
  ]
})
export class AdminModule {}
