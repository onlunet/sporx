import { Controller, Get, Query } from "@nestjs/common";
import { PredictionsService } from "./predictions.service";

@Controller("predictions")
export class PredictionsController {
  constructor(private readonly predictionsService: PredictionsService) {}

  @Get()
  list(@Query("status") status?: string, @Query("predictionType") predictionType?: string) {
    return this.predictionsService.list({ status, predictionType });
  }

  @Get("high-confidence")
  highConfidence() {
    return this.predictionsService.highConfidence();
  }
}
