import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { IngestionQueueService } from "./modules/ingestion/ingestion-queue.service";

async function bootstrapWorker() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const queue = app.get(IngestionQueueService);
  await queue.startWorker();
}

bootstrapWorker();
