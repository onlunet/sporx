import { Controller, Get, Param, Query } from "@nestjs/common";
import { MatchesService } from "./matches.service";

@Controller("matches")
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Get()
  list(@Query("status") status?: string, @Query("take") take?: string) {
    const parsedTake = Number(take);
    return this.matchesService.list({
      status,
      take: Number.isFinite(parsedTake) ? parsedTake : undefined
    });
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.matchesService.getById(id);
  }

  @Get(":id/events")
  events(@Param("id") id: string) {
    return this.matchesService.events(id);
  }

  @Get(":id/stats")
  stats(@Param("id") id: string) {
    return this.matchesService.stats(id);
  }

  @Get(":id/prediction")
  prediction(
    @Param("id") id: string,
    @Query("predictionType") predictionType?: string,
    @Query("line") line?: string,
    @Query("includeMarketAnalysis") includeMarketAnalysis?: string
  ) {
    const parsedLine = line === undefined ? undefined : Number(line);
    const includeMarket = includeMarketAnalysis === "true" || includeMarketAnalysis === "1";
    return this.matchesService.prediction(
      id,
      predictionType,
      Number.isFinite(parsedLine) ? parsedLine : undefined,
      includeMarket
    );
  }

  @Get(":id/predictions")
  predictions(
    @Param("id") id: string,
    @Query("predictionType") predictionType?: string,
    @Query("line") line?: string,
    @Query("includeMarketAnalysis") includeMarketAnalysis?: string
  ) {
    const parsedLine = line === undefined ? undefined : Number(line);
    const includeMarket = includeMarketAnalysis === "true" || includeMarketAnalysis === "1";
    return this.matchesService.predictions(
      id,
      predictionType,
      Number.isFinite(parsedLine) ? parsedLine : undefined,
      includeMarket
    );
  }

  @Get(":id/commentary")
  commentary(@Param("id") id: string, @Query("includeMarketAnalysis") includeMarketAnalysis?: string) {
    const includeMarket = includeMarketAnalysis === "true" || includeMarketAnalysis === "1";
    return this.matchesService.commentary(id, includeMarket);
  }
}
