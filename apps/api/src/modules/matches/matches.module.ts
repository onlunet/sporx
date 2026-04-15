import { Module } from "@nestjs/common";
import { PredictionsModule } from "../predictions/predictions.module";
import { MatchesController } from "./matches.controller";
import { MatchesService } from "./matches.service";

@Module({
  imports: [PredictionsModule],
  controllers: [MatchesController],
  providers: [MatchesService],
  exports: [MatchesService]
})
export class MatchesModule {}
