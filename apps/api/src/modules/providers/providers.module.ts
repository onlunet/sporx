import { Module } from "@nestjs/common";
import { ProvidersService } from "./providers.service";
import { FootballDataConnector } from "./football-data.connector";
import { TheSportsDbConnector } from "./the-sports-db.connector";
import { BallDontLieConnector } from "./ball-dont-lie.connector";
import { ApiFootballConnector } from "./api-football.connector";
import { ApiBasketballConnector } from "./api-basketball.connector";
import { ApiNbaConnector } from "./api-nba.connector";
import { ProviderIngestionService } from "./provider-ingestion.service";
import { PredictionsModule } from "../predictions/predictions.module";
import { OpenMeteoConnector } from "./open-meteo.connector";
import { MatchContextEnrichmentService } from "./match-context-enrichment.service";
import { SportApiConnector } from "./sport-api.connector";

@Module({
  imports: [PredictionsModule],
  providers: [
    ProvidersService,
    FootballDataConnector,
    TheSportsDbConnector,
    BallDontLieConnector,
    ApiFootballConnector,
    ApiBasketballConnector,
    ApiNbaConnector,
    SportApiConnector,
    OpenMeteoConnector,
    MatchContextEnrichmentService,
    ProviderIngestionService
  ],
  exports: [
    ProvidersService,
    FootballDataConnector,
    TheSportsDbConnector,
    BallDontLieConnector,
    ApiFootballConnector,
    ApiBasketballConnector,
    ApiNbaConnector,
    SportApiConnector,
    OpenMeteoConnector,
    MatchContextEnrichmentService,
    ProviderIngestionService
  ]
})
export class ProvidersModule {}
