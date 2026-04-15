import { Controller, Get, Query } from "@nestjs/common";
import { PredictionsService } from "./predictions.service";

@Controller("predictions")
export class PredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @Get()
  list(
    @Query("status") status?: string,
    @Query("sport") sport?: string,
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
      sport,
      predictionType,
      line: Number.isFinite(parsedLine) ? parsedLine : undefined,
      take: Number.isFinite(parsedTake) ? parsedTake : undefined,
      includeMarketAnalysis: includeMarket
    });
  }

  @Get("high-confidence")
  highConfidence() {
    return this.predictionsService.highConfidence();
  }
}
