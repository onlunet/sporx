import { Module } from "@nestjs/common";
import { CacheModule } from "../../cache/cache.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { OddsApiIoConnector } from "../providers/odds-api-io.connector";
import { AdminOddsController } from "./admin-odds.controller";
import { MarketAwarePredictionService } from "./market-aware-prediction.service";
import { MarketComparisonService } from "./market-comparison.service";
import { MarketSignalsService } from "./market-signals.service";
import { OddsFeatureService } from "./odds-feature.service";
import { OddsNormalizationService } from "./odds-normalization.service";
import { OddsSchemaBootstrapService } from "./odds-schema-bootstrap.service";
import { OddsService } from "./odds.service";

@Module({
  imports: [PrismaModule, CacheModule],
  controllers: [AdminOddsController],
  providers: [
    OddsService,
    OddsSchemaBootstrapService,
    OddsNormalizationService,
    OddsFeatureService,
    MarketComparisonService,
    MarketSignalsService,
    MarketAwarePredictionService,
    OddsApiIoConnector
  ],
  exports: [
    OddsService,
    OddsSchemaBootstrapService,
    OddsNormalizationService,
    OddsFeatureService,
    MarketComparisonService,
    MarketSignalsService,
    MarketAwarePredictionService
  ]
})
export class OddsModule {}
