import { Module } from "@nestjs/common";
import { StandingsService } from "./standings.service";

@Module({
  providers: [StandingsService],
  exports: [StandingsService]
})
export class StandingsModule {}

