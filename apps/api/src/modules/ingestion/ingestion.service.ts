import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { IngestionQueueService } from "./ingestion-queue.service";
import { ProviderIngestionService } from "../providers/provider-ingestion.service";

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly queuedInlineFallbackDelayMs = this.readQueuedInlineFallbackDelayMs();
  private readonly acceptedJobTypes = new Set([
    "syncFixtures",
    "syncFixturesHotPulse",
    "syncResults",
    "syncResultsReconcile",
    "syncStandings",
    "generatePredictions",
    "providerHealthCheck",
    "syncOddsPreMatch",
    "syncOddsLive",
    "syncOddsClosing",
    "generateMarketAnalysis",
    "resolveProviderAliases",
    "enrichTeamProfiles",
    "enrichMatchDetails"
  ]);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: IngestionQueueService,
    private readonly providerIngestionService: ProviderIngestionService
  ) {}

  private isSchemaCompatibilityError(error: unknown) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022" || code === "P2010") {
      return true;
    }

    const message = error instanceof Error ? error.message : String(error ?? "");
    return /relation .* does not exist|table .* does not exist|column .* does not exist|no such table|unknown column/i.test(
      message.toLowerCase()
    );
  }

  private normalizeJobType(jobType: string) {
    const normalized = String(jobType ?? "").trim();
    if (!this.acceptedJobTypes.has(normalized)) {
      return null;
    }
    return normalized;
  }

  private async runSchemaCompatibilityFallback(jobType: string) {
    const runId = `compat-${jobType}-${randomUUID()}`;
    const summary = await this.providerIngestionService.sync(jobType, runId);
    return {
      id: runId,
      jobType,
      status: "succeeded",
      startedAt: new Date(),
      finishedAt: new Date(),
      recordsRead: summary.recordsRead,
      recordsWritten: summary.recordsWritten,
      errors: summary.errors,
      logs: {
        mode: "schema_compatibility_inline_sync",
        summary: summary.logs
      }
    };
  }

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

  private readQueuedInlineFallbackDelayMs() {
    const raw = process.env.INGESTION_QUEUED_INLINE_FALLBACK_DELAY_MS;
    if (!raw) {
      return 60_000;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return 60_000;
    }
    return Math.min(10 * 60_000, Math.trunc(parsed));
  }

  private shouldScheduleQueuedInlineFallback(jobType: string) {
    return jobType === "generatePredictions" && this.queuedInlineFallbackDelayMs > 0;
  }

  async run(jobType: string) {
    const normalizedJobType = this.normalizeJobType(jobType);
    if (!normalizedJobType) {
      return {
        id: `compat-unsupported-${randomUUID()}`,
        jobType: String(jobType ?? ""),
        status: "failed",
        startedAt: null,
        finishedAt: new Date(),
        recordsRead: 0,
        recordsWritten: 0,
        errors: 1,
        logs: {
          message: `Unsupported job type: ${jobType}`
        }
      };
    }

    try {
      const ingestionJobId = await this.resolveIngestionJobId(normalizedJobType);

      const run = await this.prisma.ingestionJobRun.create({
        data: {
          ingestionJobId,
          jobType: normalizedJobType,
          status: "queued"
        }
      });

      try {
        await this.queue.enqueuePipeline(normalizedJobType, { runId: run.id, jobType: normalizedJobType });
        if (
          this.shouldScheduleQueuedInlineFallback(normalizedJobType) &&
          typeof this.queue.runInlineFallbackAfter === "function"
        ) {
          this.queue.runInlineFallbackAfter(run.id, normalizedJobType, this.queuedInlineFallbackDelayMs);
        }
      } catch (error) {
        this.logger.warn(
          `Queue enqueue failed for run ${run.id}; continuing with inline fallback: ${
            error instanceof Error ? error.message : "unknown enqueue error"
          }`
        );
        this.queue.runInlineFallback(run.id, normalizedJobType);
      }

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
    } catch (error) {
      if (this.isSchemaCompatibilityError(error)) {
        this.logger.warn(
          `Ingestion schema compatibility fallback engaged for ${normalizedJobType}: ${
            error instanceof Error ? error.message : "unknown schema error"
          }`
        );
        return this.runSchemaCompatibilityFallback(normalizedJobType);
      }
      throw error;
    }
  }

  async listRuns() {
    try {
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
    } catch (error) {
      if (this.isSchemaCompatibilityError(error)) {
        this.logger.warn(
          `Ingestion jobs list fallback engaged due schema compatibility issue: ${
            error instanceof Error ? error.message : "unknown schema error"
          }`
        );
        return [];
      }
      throw error;
    }
  }

  async runHalfTimeBackfill(daysBack?: number) {
    const rewind = await this.providerIngestionService.rewindFootballResultsCheckpoints(daysBack ?? 180);
    const run = await this.run("syncResults");
    const detailEnrichment = await this.run("enrichMatchDetails");
    return {
      ...run,
      detailEnrichment,
      backfill: rewind
    };
  }
}
