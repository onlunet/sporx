import { Module } from "@nestjs/common";
import { BullModule } from "@nestjs/bullmq";
import { IngestionService } from "./ingestion.service";
import { IngestionQueueService } from "./ingestion-queue.service";
import { ProvidersModule } from "../providers/providers.module";

@Module({
  imports: [
    BullModule.registerQueue({
      name: "ingestion"
    }),
    ProvidersModule
  ],
  providers: [IngestionService, IngestionQueueService],
  exports: [IngestionService, IngestionQueueService]
})
export class IngestionModule {}
