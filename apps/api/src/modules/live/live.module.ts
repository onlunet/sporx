import { Module } from "@nestjs/common";
import { LiveService } from "./live.service";

@Module({
  providers: [LiveService],
  exports: [LiveService]
})
export class LiveModule {}

