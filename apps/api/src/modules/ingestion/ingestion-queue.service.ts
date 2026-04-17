import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { FlowProducer, Queue, Worker } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { ProviderIngestionService } from "../providers/provider-ingestion.service";

const PIPELINE_STAGES = new Set([
  "ingestRaw",
  "canonicalMerge",
  "featureSnapshot",
  "oddsSnapshot",
  "lineupSnapshot",
  "eventEnrichment",
  "marketConsensus",
  "predictionRun",
  "metaModelRefine",
  "calibrateScore",
  "candidateBuild",
  "selectionScore",
  "abstainFilter",
  "conflictResolution",
  "publishDecision",
  "publicPublish",
  "invalidateCache"
]);

@Injectable()
export class IngestionQueueService {
  private readonly logger = new Logger(IngestionQueueService.name);
  private workerStarted = false;
  private flowProducer: FlowProducer | null = null;

  constructor(
    @InjectQueue("ingestion") private readonly ingestionQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly providerIngestionService: ProviderIngestionService
  ) {}

  private getFlowProducer() {
    if (this.flowProducer) {
      return this.flowProducer;
    }
    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    this.flowProducer = new FlowProducer({ connection: { url } });
    return this.flowProducer;
  }

  private resolveDedupOptions(payload: Record<string, unknown>) {
    const matchId = typeof payload.matchId === "string" ? payload.matchId.trim() : "";
    const market = typeof payload.market === "string" ? payload.market.trim() : "";
    const horizon = typeof payload.horizon === "string" ? payload.horizon.trim() : "";
    const lineRaw = payload.line;
    const lineToken =
      typeof lineRaw === "number" && Number.isFinite(lineRaw)
        ? Number(lineRaw).toFixed(2)
        : typeof lineRaw === "string" && lineRaw.trim().length > 0
          ? lineRaw.trim()
          : "na";

    if (!matchId || !market || !horizon) {
      return {
        payload,
        jobId: undefined as string | undefined,
        keepLastIfActive: false
      };
    }

    const dedupKey = `match:${matchId}:market:${market}:line:${lineToken}:h:${horizon}`;
    const normalizedHorizon = horizon.toUpperCase();
    const keepLastIfActive = normalizedHorizon === "HT" || normalizedHorizon.startsWith("LIVE_");
    return {
      payload: {
        ...payload,
        dedupKey,
        ...(keepLastIfActive ? { keepLastIfActive: true } : {})
      },
      jobId: dedupKey,
      keepLastIfActive
    };
  }

  private async recordDuplicateSuppression(dedupKey: string, payload: Record<string, unknown>) {
    const matchId = typeof payload.matchId === "string" ? payload.matchId : null;
    const market = typeof payload.market === "string" ? payload.market : null;
    const lineKey =
      typeof payload.line === "number" && Number.isFinite(payload.line)
        ? Number(payload.line).toFixed(2)
        : typeof payload.line === "string" && payload.line.trim().length > 0
          ? payload.line.trim()
          : "na";
    const horizon = typeof payload.horizon === "string" ? payload.horizon : null;

    await this.prisma.duplicateSuppressionStat.upsert({
      where: { dedupKey },
      update: {
        suppressedCount: { increment: 1 },
        lastSuppressedAt: new Date()
      },
      create: {
        dedupKey,
        matchId,
        market,
        lineKey,
        horizon,
        suppressedCount: 1,
        firstSuppressedAt: new Date(),
        lastSuppressedAt: new Date()
      }
    });
  }

  async enqueue(jobName: string, payload: Record<string, unknown>) {
    const dedup = this.resolveDedupOptions(payload);
    this.logger.log(
      JSON.stringify({
        event: "queue_enqueue_request",
        jobName,
        jobId: dedup.jobId ?? null,
        dedupId: typeof dedup.payload.dedupKey === "string" ? dedup.payload.dedupKey : null,
        match_id: typeof dedup.payload.matchId === "string" ? dedup.payload.matchId : null,
        horizon: typeof dedup.payload.horizon === "string" ? dedup.payload.horizon : null
      })
    );
    if (dedup.keepLastIfActive && dedup.jobId) {
      const existing = await this.ingestionQueue.getJob(dedup.jobId);
      if (existing) {
        const state = await existing.getState();
        if (state === "active" || state === "waiting" || state === "delayed") {
          await existing.updateData(dedup.payload);
          try {
            await this.recordDuplicateSuppression(dedup.jobId, dedup.payload);
          } catch (error) {
            this.logger.warn(
              `Duplicate suppression stat write skipped for ${dedup.jobId}: ${
                error instanceof Error ? error.message : "unknown"
              }`
            );
          }
          return existing;
        }
      }
    }

    return this.ingestionQueue.add(jobName, dedup.payload, {
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 2,
      backoff: {
        type: "exponential",
        delay: 2000
      },
      ...(dedup.jobId ? { jobId: dedup.jobId } : {})
    });
  }

  async enqueuePipeline(jobType: string, payload: Record<string, unknown>) {
    const runId = typeof payload.runId === "string" ? payload.runId : "";
    this.logger.log(
      JSON.stringify({
        event: "queue_pipeline_enqueued",
        source_job_type: jobType,
        runId: runId || null
      })
    );
    const sharedOpts = {
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts: 2,
      backoff: {
        type: "exponential" as const,
        delay: 2000
      }
    };
    const flow = this.getFlowProducer();
    const stages = [
      "ingestRaw",
      "canonicalMerge",
      "featureSnapshot",
      "oddsSnapshot",
      "lineupSnapshot",
      "eventEnrichment",
      "marketConsensus",
      "predictionRun",
      "metaModelRefine",
      "calibrateScore",
      "candidateBuild",
      "selectionScore",
      "abstainFilter",
      "conflictResolution",
      "publishDecision",
      "publicPublish",
      "invalidateCache"
    ] as const;

    const createStageNode = (
      stage: (typeof stages)[number],
      children?: Array<Record<string, unknown>>
    ): Record<string, unknown> => ({
      name: stage,
      queueName: "ingestion",
      data: {
        ...payload,
        sourceJobType: jobType
      },
      opts: {
        ...sharedOpts,
        jobId: runId ? `run:${runId}:${stage}` : undefined
      },
      ...(children && children.length > 0 ? { children } : {})
    });

    let rootNode: Record<string, unknown> = createStageNode(stages[0]);
    for (let index = 1; index < stages.length; index += 1) {
      rootNode = createStageNode(stages[index], [rootNode]);
    }

    return flow.add(rootNode as any);
  }

  private async processRun(runId: string, jobType: string) {
    const claim = await this.prisma.ingestionJobRun.updateMany({
      where: { id: runId, status: "queued" },
      data: { status: "running", startedAt: new Date() }
    });

    if (claim.count === 0) {
      return false;
    }

    try {
      const result = await this.providerIngestionService.sync(jobType, runId);

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
      return true;
    } catch (error) {
      this.logger.error(`Ingestion processRun failed for ${runId}`, error instanceof Error ? error.stack : undefined);
      await this.prisma.publishFailureLog.create({
        data: {
          runId,
          jobId: null,
          matchId: null,
          market: null,
          lineKey: null,
          horizon: null,
          dedupKey: null,
          errorCode: "INGESTION_PROCESS_RUN_FAILED",
          errorMessage: error instanceof Error ? error.message : "Unknown worker error",
          details: {
            stage: jobType
          }
        }
      }).catch(() => undefined);
      await this.prisma.ingestionJobRun.update({
        where: { id: runId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          errors: 1,
          logs: { message: error instanceof Error ? error.message : "Unknown worker error" }
        }
      });
      return false;
    }
  }

  runInlineFallback(runId: string, jobType: string) {
    setImmediate(() => {
      this.processRun(runId, jobType).catch((error) => {
        this.logger.error(
          `Inline fallback failed for ${runId}`,
          error instanceof Error ? error.stack : undefined
        );
      });
    });
  }

  async startWorker() {
    if (this.workerStarted) {
      return;
    }
    this.workerStarted = true;

    const url = process.env.REDIS_URL ?? "redis://localhost:6379";
    const role = (process.env.SERVICE_ROLE ?? "api").toLowerCase();
    const fallbackConcurrency = 1;
    const parsedConcurrency = Number(process.env.INGESTION_WORKER_CONCURRENCY ?? fallbackConcurrency);
    const concurrency =
      Number.isFinite(parsedConcurrency) && parsedConcurrency > 0
        ? Math.max(1, Math.min(8, Math.floor(parsedConcurrency)))
        : fallbackConcurrency;
    const worker = new Worker(
      "ingestion",
      async (job) => {
        const runId = String(job.data.runId ?? "");
        if (!runId) {
          return;
        }

        const stage = String(job.name);
        const sourceJobType = String(job.data.sourceJobType ?? job.data.jobType ?? "");
        this.logger.log(
          JSON.stringify({
            event: "queue_stage_started",
            jobId: job.id ? String(job.id) : null,
            runId,
            stage,
            source_job_type: sourceJobType || null,
            match_id: typeof job.data.matchId === "string" ? job.data.matchId : null,
            horizon: typeof job.data.horizon === "string" ? job.data.horizon : null,
            dedupId: typeof job.data.dedupKey === "string" ? job.data.dedupKey : null
          })
        );
        if (PIPELINE_STAGES.has(stage)) {
          if (stage !== "invalidateCache") {
            return;
          }
          await this.processRun(runId, sourceJobType.length > 0 ? sourceJobType : stage);
          return;
        }

        await this.processRun(runId, stage);
      },
      { connection: { url }, concurrency }
    );

    worker.on("completed", (job) => {
      this.logger.log(
        JSON.stringify({
          event: "queue_stage_completed",
          jobId: job.id ? String(job.id) : null,
          runId: typeof job.data?.runId === "string" ? job.data.runId : null,
          stage: job.name,
          source_job_type:
            typeof job.data?.sourceJobType === "string"
              ? job.data.sourceJobType
              : typeof job.data?.jobType === "string"
                ? job.data.jobType
                : null
        })
      );
    });

    worker.on("failed", async (job, error) => {
      this.logger.error(`Ingestion job failed: ${job?.id}`, error?.stack);
      const runId = String(job?.data?.runId ?? "");
      await this.prisma.publishFailureLog.create({
        data: {
          runId: runId.length > 0 ? runId : null,
          jobId: job?.id ? String(job.id) : null,
          matchId: typeof job?.data?.matchId === "string" ? job.data.matchId : null,
          market: typeof job?.data?.market === "string" ? job.data.market : null,
          lineKey:
            typeof job?.data?.line === "number" && Number.isFinite(job.data.line)
              ? Number(job.data.line).toFixed(2)
              : typeof job?.data?.line === "string" && job.data.line.trim().length > 0
                ? job.data.line.trim()
                : null,
          horizon: typeof job?.data?.horizon === "string" ? job.data.horizon : null,
          dedupKey: typeof job?.data?.dedupKey === "string" ? job.data.dedupKey : null,
          errorCode: "INGESTION_JOB_FAILED",
          errorMessage: error?.message ?? "Unknown worker error",
          details: {
            stage: job?.name ?? null
          }
        }
      }).catch(() => undefined);
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

    this.logger.log(`Ingestion worker started (concurrency=${concurrency}, role=${role})`);
  }
}
