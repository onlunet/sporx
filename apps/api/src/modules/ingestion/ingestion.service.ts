import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { IngestionQueueService } from "./ingestion-queue.service";
import { ProviderIngestionService } from "../providers/provider-ingestion.service";

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: IngestionQueueService,
    private readonly providerIngestionService: ProviderIngestionService
  ) {}

  private async resolveIngestionJobId(jobType: string) {
    const existing = await this.prisma.ingestionJob.findFirst({
      where: { jobType, active: true },
      orderBy: { createdAt: "desc" },
      select: { id: true }
    });

    if (existing) {
      return existing.id;
    }

    const created = await this.prisma.ingestionJob.create({
      data: {
        jobType,
        active: true
      },
      select: { id: true }
    });

    return created.id;
  }

  async run(jobType: string) {
    const ingestionJobId = await this.resolveIngestionJobId(jobType);

    const run = await this.prisma.ingestionJobRun.create({
      data: {
        ingestionJobId,
        jobType,
        status: "queued"
      }
    });

    await this.queue.enqueuePipeline(jobType, { runId: run.id, jobType });
    this.queue.runInlineFallback(run.id, jobType);

    return {
      id: run.id,
      jobType: run.jobType,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      recordsRead: run.recordsRead,
      recordsWritten: run.recordsWritten,
      errors: run.errors
    };
  }

  async listRuns() {
    const runs = await this.prisma.ingestionJobRun.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return runs.map(
      (run: {
        id: string;
        jobType: string;
        status: string;
        startedAt: Date | null;
        finishedAt: Date | null;
        recordsRead: number;
        recordsWritten: number;
        errors: number;
        logs: unknown;
      }) => ({
        id: run.id,
        jobType: run.jobType,
        status: run.status,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        recordsRead: run.recordsRead,
        recordsWritten: run.recordsWritten,
        errors: run.errors,
        logs: run.logs
      })
    );
  }

  async runHalfTimeBackfill(daysBack?: number) {
    const rewind = await this.providerIngestionService.rewindFootballResultsCheckpoints(daysBack ?? 180);
    const run = await this.run("syncResults");
    return {
      ...run,
      backfill: rewind
    };
  }
}
