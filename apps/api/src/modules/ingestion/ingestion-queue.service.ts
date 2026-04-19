import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { FlowProducer, Queue, Worker } from "bullmq";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { ProviderIngestionService } from "../providers/provider-ingestion.service";
import { InternalRuntimeSecurityService } from "../security-hardening/internal-runtime-security.service";

@Injectable()
export class IngestionQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(IngestionQueueService.name);
  private readonly runHeartbeatMs = this.readRunHeartbeatMs();
  private worker: Worker | null = null;
  private workerStartPromise: Promise<void> | null = null;
  private flowProducer: FlowProducer | null = null;

  constructor(
    @InjectQueue("ingestion") private readonly ingestionQueue: Queue,
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly providerIngestionService: ProviderIngestionService,
    private readonly internalRuntimeSecurityService: InternalRuntimeSecurityService
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
    const validated = await this.internalRuntimeSecurityService.validateQueuePayload({
      queueName: "ingestion",
      jobName,
      payload,
      mode: "enqueue",
      serviceIdentityId: typeof payload.serviceIdentityId === "string" ? payload.serviceIdentityId : undefined
    });
    const dedup = this.resolveDedupOptions(validated.payload);
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
    const validated = await this.internalRuntimeSecurityService.validateQueuePayload({
      queueName: "ingestion",
      jobName: jobType,
      payload,
      mode: "enqueue",
      serviceIdentityId: typeof payload.serviceIdentityId === "string" ? payload.serviceIdentityId : undefined
    });
    const runId = typeof validated.payload.runId === "string" ? validated.payload.runId : "";
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
    const node = {
      name: jobType,
      queueName: "ingestion",
      data: {
        ...validated.payload,
        sourceJobType: jobType
      },
      opts: {
        ...sharedOpts,
        jobId: runId ? `run:${runId}:${jobType}` : undefined
      }
    };

    return flow.add(node as any);
  }

  private async processRun(runId: string, jobType: string) {
    const claim = await this.prisma.ingestionJobRun.updateMany({
      where: { id: runId, status: "queued" },
      data: { status: "running", startedAt: new Date() }
    });

    if (claim.count === 0) {
      return false;
    }

    const stopHeartbeat = this.startRunHeartbeat(runId);

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
    } finally {
      await stopHeartbeat();
    }
  }

  private readRunHeartbeatMs() {
    const raw = process.env.INGESTION_RUN_HEARTBEAT_MS;
    const fallback = 60_000;
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 5_000) {
      return fallback;
    }
    return Math.round(parsed);
  }

  private startRunHeartbeat(runId: string) {
    const intervalMs = this.runHeartbeatMs;
    if (intervalMs <= 0) {
      return async () => undefined;
    }

    let stopped = false;
    let inFlight: Promise<void> | null = null;
    const timer = setInterval(() => {
      if (stopped) {
        return;
      }
      inFlight = this.heartbeatRun(runId);
    }, intervalMs);

    return async () => {
      stopped = true;
      clearInterval(timer);
      if (inFlight) {
        await inFlight.catch(() => undefined);
      }
    };
  }

  private async heartbeatRun(runId: string) {
    try {
      await this.prisma.ingestionJobRun.updateMany({
        where: { id: runId, status: "running" },
        data: { startedAt: new Date() }
      });
    } catch (error) {
      this.logger.warn(
        `Ingestion run heartbeat skipped for ${runId}: ${error instanceof Error ? error.message : "unknown"}`
      );
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

  async onModuleDestroy() {
    if (this.worker) {
      const worker = this.worker;
      this.worker = null;
      await worker.close().catch(() => undefined);
    }

    if (this.flowProducer) {
      const flowProducer = this.flowProducer;
      this.flowProducer = null;
      await flowProducer.close().catch(() => undefined);
    }
  }

  async startWorker() {
    if (this.worker) {
      return;
    }
    if (this.workerStartPromise) {
      await this.workerStartPromise;
      return;
    }

    this.workerStartPromise = this.startWorkerInternal();
    try {
      await this.workerStartPromise;
    } finally {
      this.workerStartPromise = null;
    }
  }

  private async startWorkerInternal() {
    if (this.worker) {
      return;
    }

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
        const stage = String(job.name);
        const validated = await this.internalRuntimeSecurityService.validateQueuePayload({
          queueName: "ingestion",
          jobName: stage,
          payload: (job.data ?? {}) as Record<string, unknown>,
          mode: "process",
          serviceIdentityId: typeof job.data?.serviceIdentityId === "string" ? job.data.serviceIdentityId : undefined
        });
        const runId = String(validated.payload.runId ?? "");
        const sourceJobType = String(validated.payload.sourceJobType ?? validated.payload.jobType ?? "");
        this.logger.log(
          JSON.stringify({
            event: "queue_stage_started",
            jobId: job.id ? String(job.id) : null,
            runId,
            stage,
            source_job_type: sourceJobType || null,
            match_id: typeof validated.payload.matchId === "string" ? validated.payload.matchId : null,
            horizon: typeof validated.payload.horizon === "string" ? validated.payload.horizon : null,
            dedupId: typeof validated.payload.dedupKey === "string" ? validated.payload.dedupKey : null
          })
        );
        await this.processRun(runId, sourceJobType.length > 0 ? sourceJobType : stage);
      },
      { connection: { url }, concurrency }
    );

    worker.on("error", (error) => {
      this.logger.error("Ingestion worker connection error", error instanceof Error ? error.stack : undefined);
    });

    worker.on("closed", () => {
      if (this.worker === worker) {
        this.worker = null;
      }
      this.logger.warn("Ingestion worker closed");
    });

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
      if (job?.name) {
        await this.internalRuntimeSecurityService
          .quarantinePoisonJob({
            queueName: "ingestion",
            jobName: String(job.name),
            reason: error?.message ?? "queue_job_failed",
            payload: (job.data ?? null) as Record<string, unknown> | null,
            serviceIdentityId: typeof job.data?.serviceIdentityId === "string" ? job.data.serviceIdentityId : null
          })
          .catch(() => undefined);
      }
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

    try {
      await worker.waitUntilReady();
    } catch (error) {
      await worker.close().catch(() => undefined);
      throw error;
    }

    this.worker = worker;
    this.logger.log(`Ingestion worker started (concurrency=${concurrency}, role=${role})`);
  }
}
