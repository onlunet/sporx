import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { ProviderIngestionService } from "../providers/provider-ingestion.service";

@Injectable()
export class IngestionQueueService {
  private readonly logger = new Logger(IngestionQueueService.name);

  constructor(
    @InjectQueue("ingestion") private readonly ingestionQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly providerIngestionService: ProviderIngestionService
  ) {}

  enqueue(jobName: string, payload: Record<string, unknown>) {
    return this.ingestionQueue.add(jobName, payload, {
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 2000
      }
    });
  }

  async startWorker() {
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    const worker = new Worker(
      "ingestion",
      async (job) => {
        const runId = String(job.data.runId ?? "");
        if (!runId) {
          return;
        }

        await this.prisma.ingestionJobRun.update({
          where: { id: runId },
          data: { status: "running", startedAt: new Date() }
        });

        const result = await this.providerIngestionService.sync(String(job.name), runId);

        await this.prisma.ingestionJobRun.update({
          where: { id: runId },
          data: {
            status: "succeeded",
            finishedAt: new Date(),
            recordsRead: result.recordsRead,
            recordsWritten: result.recordsWritten,
            errors: result.errors,
            logs: result.logs as Prisma.InputJsonValue
          }
        });

        await Promise.all([
          this.cache.invalidateTag("matches"),
          this.cache.invalidateTag("predictions"),
          this.cache.invalidateTag("standings"),
          this.cache.invalidateTag("dashboard"),
          this.cache.invalidateTag("compare"),
          this.cache.invalidateTag("odds"),
          this.cache.invalidateTag("market-analysis")
        ]);
      },
      { connection: { url }, concurrency: 4 }
    );

    worker.on("completed", (job) => {
      this.logger.log(`Ingestion job completed: ${job.id}`);
    });

    worker.on("failed", async (job, error) => {
      this.logger.error(`Ingestion job failed: ${job?.id}`, error?.stack);
      const runId = String(job?.data?.runId ?? "");
      if (runId) {
        await this.prisma.ingestionJobRun.update({
          where: { id: runId },
          data: {
            status: "failed",
            finishedAt: new Date(),
            errors: 1,
            logs: { message: error?.message ?? "Unknown worker error" }
          }
        });
      }
    });

    this.logger.log("Ingestion worker started");
  }
}
