import { Controller, Get, Param, Query } from "@nestjs/common";
import { PredictionsService } from "./predictions.service";

@Controller("basketball")
export class BasketballPredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @Get("predictions")
  list(
    @Query("status") status?: string,
    @Query("predictionType") predictionType?: string,
    @Query("line") line?: string,
    @Query("take") take?: string,
    @Query("includeMarketAnalysis") includeMarketAnalysis?: string
  ) {
    const parsedLine = line === undefined ? undefined : Number(line);
    const parsedTake = take === undefined ? undefined : Number(take);
    const includeMarket = includeMarketAnalysis === "true" || includeMarketAnalysis === "1";
    return this.predictionsService.list({
      status,
      sport: "basketball",
      predictionType,
      line: Number.isFinite(parsedLine) ? parsedLine : undefined,
      take: Number.isFinite(parsedTake) ? parsedTake : undefined,
      includeMarketAnalysis: includeMarket
    });
  }

  @Get("predictions/:matchId")
  byMatch(
    @Param("matchId") matchId: string,
    @Query("predictionType") predictionType?: string,
    @Query("line") line?: string,
    @Query("includeMarketAnalysis") includeMarketAnalysis?: string
  ) {
    const parsedLine = line === undefined ? undefined : Number(line);
    const includeMarket = includeMarketAnalysis === "true" || includeMarketAnalysis === "1";
    return this.predictionsService.listByMatch(matchId, {
      predictionType,
      line: Number.isFinite(parsedLine) ? parsedLine : undefined,
      includeMarketAnalysis: includeMarket
    });
  }
}
