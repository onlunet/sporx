import { Module } from "@nestjs/common";
import { IngestionModule } from "../ingestion/ingestion.module";
import { JobsService } from "./jobs.service";

@Module({
  imports: [IngestionModule],
  providers: [JobsService],
  exports: [JobsService]
})
export class JobsModule {}
