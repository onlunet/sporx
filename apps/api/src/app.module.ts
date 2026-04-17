import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { BullModule } from "@nestjs/bullmq";
import { AuthModule } from "./auth/auth.module";
import { UsersModule } from "./users/users.module";
import { SportsModule } from "./modules/sports/sports.module";
import { LeaguesModule } from "./modules/leagues/leagues.module";
import { SeasonsModule } from "./modules/seasons/seasons.module";
import { TeamsModule } from "./modules/teams/teams.module";
import { PlayersModule } from "./modules/players/players.module";
import { MatchesModule } from "./modules/matches/matches.module";
import { StandingsModule } from "./modules/standings/standings.module";
import { StatsModule } from "./modules/stats/stats.module";
import { PredictionsModule } from "./modules/predictions/predictions.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { TeamComparisonModule } from "./modules/team-comparison/team-comparison.module";
import { ProvidersModule } from "./modules/providers/providers.module";
import { IngestionModule } from "./modules/ingestion/ingestion.module";
import { HistoricalImportModule } from "./modules/historical-import/historical-import.module";
import { JobsModule } from "./modules/jobs/jobs.module";
import { LiveModule } from "./modules/live/live.module";
import { AdminModule } from "./modules/admin/admin.module";
import { ModelsModule } from "./modules/models/models.module";
import { CalibrationModule } from "./modules/calibration/calibration.module";
import { BacktestModule } from "./modules/backtest/backtest.module";
import { DriftModule } from "./modules/drift/drift.module";
import { FeatureLabModule } from "./modules/feature-lab/feature-lab.module";
import { StrategyModule } from "./modules/strategy/strategy.module";
import { LogsModule } from "./modules/logs/logs.module";
import { SystemModule } from "./modules/system/system.module";
import { HealthModule } from "./modules/health/health.module";
import { OddsModule } from "./modules/odds/odds.module";
import { BankrollModule } from "./modules/bankroll/bankroll.module";
import { ResearchLabModule } from "./modules/research-lab/research-lab.module";
import { PrismaModule } from "./prisma/prisma.module";
import { CacheModule } from "./cache/cache.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL
      }
    }),
    PrismaModule,
    CacheModule,
    AuthModule,
    UsersModule,
    SportsModule,
    LeaguesModule,
    SeasonsModule,
    TeamsModule,
    PlayersModule,
    MatchesModule,
    StandingsModule,
    StatsModule,
    PredictionsModule,
    AnalyticsModule,
    TeamComparisonModule,
    ProvidersModule,
    IngestionModule,
    HistoricalImportModule,
    JobsModule,
    LiveModule,
    AdminModule,
    ModelsModule,
    CalibrationModule,
    BacktestModule,
    DriftModule,
    FeatureLabModule,
    StrategyModule,
    LogsModule,
    SystemModule,
    HealthModule,
    OddsModule,
    BankrollModule,
    ResearchLabModule
  ]
})
export class AppModule {}

