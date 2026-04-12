import { Module } from "@nestjs/common";
import { FeatureLabService } from "./feature-lab.service";

@Module({
  providers: [FeatureLabService],
  exports: [FeatureLabService]
})
export class FeatureLabModule {}

