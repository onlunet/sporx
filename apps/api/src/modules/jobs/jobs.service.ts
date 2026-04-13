import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { IngestionStatus } from "@prisma/client";
import { CacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import { IngestionService } from "../ingestion/ingestion.service";

type JobType =
  | "syncFixtures"
  | "syncStandings"
  | "generatePredictions"
  | "providerHealthCheck"
  | "syncOddsPreMatch"
  | "syncOddsLive"
  | "syncOddsClosing"
  | "generateMarketAnalysis"
  | "resolveProviderAliases"
  | "enrichTeamProfiles"
  | "enrichMatchDetails";

const JOB_TYPES: JobType[] = [
  "syncFixtures",
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
];

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly isWorker = (process.env.SERVICE_ROLE ?? "api") === "worker";
  private readonly tickMs = 60_000;
  private readonly staleThresholdMs = this.readStaleThresholdMs();
  private readonly schedulerLockKey = process.env.SCHEDULER_LOCK_KEY ?? "jobs-scheduler";
  private readonly schedulerLockOwner = `${process.env.HOSTNAME ?? "worker"}:${process.pid}`;
  private readonly schedulerLockTtlMs = this.readSchedulerLockTtlMs();
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestionService: IngestionService,
    private readonly cacheService: CacheService
  ) {}

  async onModuleInit() {
    if (!this.isWorker) {
      return;
    }

    await this.recoverStaleRuns();
    await this.ensureDefaultJobs();
    await this.tick("startup");

    this.timer = setInterval(() => {
      void this.tick("interval");
    }, this.tickMs);

    this.logger.log("Background job scheduler started");
  }

  async onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(reason: "startup" | "interval") {
    if (this.isTicking) {
      return;
    }

    this.isTicking = true;
    const lockAcquired = await this.cacheService.acquireLock(
      this.schedulerLockKey,
      this.schedulerLockOwner,
      this.schedulerLockTtlMs
    );

    if (!lockAcquired) {
      this.isTicking = false;
      return;
    }

    try {
      await this.recoverStaleRuns();

      const syncEveryMinutes = await this.resolveSyncIntervalMinutes();
      const standingsMinutes = await this.resolveSettingMinutes("sync.interval.standingsMinutes", 360);
      const aliasSyncMinutes = await this.resolveSettingMinutes("sync.interval.aliasMinutes", 360);
      const teamProfileMinutes = await this.resolveSettingMinutes("sync.interval.teamProfileMinutes", 240);
      const detailMinutes = await this.resolveSettingMinutes("sync.interval.matchDetailMinutes", 120);
      await this.ensureRecentRun("syncFixtures", syncEveryMinutes, reason === "startup");
      await this.ensureRecentRun("syncStandings", standingsMinutes, reason === "startup");
      await this.ensureRecentRun("generatePredictions", syncEveryMinutes, reason === "startup");
      await this.ensureRecentRun("providerHealthCheck", 30, reason === "startup");
      await this.ensureRecentRun("syncOddsPreMatch", 30, reason === "startup");
      await this.ensureRecentRun("syncOddsLive", 5, reason === "startup");
      await this.ensureRecentRun("syncOddsClosing", 20, reason === "startup");
      await this.ensureRecentRun("generateMarketAnalysis", 20, reason === "startup");
      await this.ensureRecentRun("resolveProviderAliases", aliasSyncMinutes, reason === "startup");
      await this.ensureRecentRun("enrichTeamProfiles", teamProfileMinutes, reason === "startup");
      await this.ensureRecentRun("enrichMatchDetails", detailMinutes, reason === "startup");
    } finally {
      await this.cacheService.releaseLock(this.schedulerLockKey, this.schedulerLockOwner);
      this.isTicking = false;
    }
  }

  private async ensureDefaultJobs() {
    for (const jobType of JOB_TYPES) {
      const existing = await this.prisma.ingestionJob.findFirst({
        where: { jobType }
      });
      if (existing) {
        continue;
      }
      await this.prisma.ingestionJob.create({
        data: {
          jobType,
          active: true
        }
      });
    }
  }

  private async resolveSyncIntervalMinutes() {
    const [defaultSetting, matchDaySetting, nextDayMatches] = await Promise.all([
      this.prisma.systemSetting.findUnique({ where: { key: "sync.interval.defaultMinutes" } }),
      this.prisma.systemSetting.findUnique({ where: { key: "sync.interval.matchDayMinutes" } }),
      this.prisma.match.count({
        where: {
          status: { in: ["scheduled", "live"] },
          matchDateTimeUTC: {
            gte: new Date(),
            lte: new Date(Date.now() + 24 * 60 * 60 * 1000)
          }
        }
      })
    ]);

    const defaultMinutes = this.settingNumber(defaultSetting?.value, 60);
    const matchDayMinutes = this.settingNumber(matchDaySetting?.value, 15);
    return nextDayMatches > 0 ? matchDayMinutes : defaultMinutes;
  }

  private async resolveSettingMinutes(key: string, fallback: number) {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key } });
    return this.settingNumber(setting?.value, fallback);
  }

  private settingNumber(value: unknown, fallback: number) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(1, Math.round(value));
    }

    if (value && typeof value === "object" && !Array.isArray(value)) {
      const candidate = (value as Record<string, unknown>).value;
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return Math.max(1, Math.round(candidate));
      }
      if (typeof candidate === "string") {
        const parsed = Number(candidate);
        if (Number.isFinite(parsed)) {
          return Math.max(1, Math.round(parsed));
        }
      }
    }

    return fallback;
  }

  private readStaleThresholdMs() {
    const raw = process.env.INGESTION_STALE_RUN_MINUTES;
    const fallbackMinutes = 15;
    if (!raw) {
      return fallbackMinutes * 60 * 1000;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallbackMinutes * 60 * 1000;
    }

    return Math.round(parsed) * 60 * 1000;
  }

  private readSchedulerLockTtlMs() {
    const raw = process.env.SCHEDULER_LOCK_TTL_MS;
    const fallback = 55_000;
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 5_000) {
      return fallback;
    }

    return Math.round(parsed);
  }

  private async ensureRecentRun(jobType: JobType, maxAgeMinutes: number, forceOnStartup: boolean) {
    const latest = await this.prisma.ingestionJobRun.findFirst({
      where: { jobType },
      orderBy: { createdAt: "desc" }
    });

    if (latest && (latest.status === IngestionStatus.queued || latest.status === IngestionStatus.running)) {
      const startedAt = latest.startedAt ?? latest.createdAt;
      const ageMs = Date.now() - startedAt.getTime();
      if (ageMs < this.staleThresholdMs) {
        return;
      }
    }

    if (latest && latest.status === IngestionStatus.succeeded && !forceOnStartup) {
      const referenceAt = latest.finishedAt ?? latest.startedAt ?? latest.createdAt;
      const elapsedMs = Date.now() - referenceAt.getTime();
      if (elapsedMs < maxAgeMinutes * 60 * 1000) {
        return;
      }
    }

    try {
      const run = await this.ingestionService.run(jobType);
      this.logger.log(`Scheduled ingestion run created for ${jobType}: ${run.id}`);
    } catch (error) {
      this.logger.error(`Failed to create scheduled run for ${jobType}`, error instanceof Error ? error.stack : undefined);
    }
  }

  private async recoverStaleRuns() {
    const staleBefore = new Date(Date.now() - this.staleThresholdMs);
    const staleRuns = await this.prisma.ingestionJobRun.findMany({
      where: {
        status: { in: [IngestionStatus.queued, IngestionStatus.running] },
        OR: [{ startedAt: { lt: staleBefore } }, { startedAt: null, createdAt: { lt: staleBefore } }]
      },
      select: { id: true, status: true, startedAt: true, createdAt: true }
    });

    if (staleRuns.length === 0) {
      return;
    }

    const now = new Date();
    for (const run of staleRuns) {
      await this.prisma.ingestionJobRun.update({
        where: { id: run.id },
        data: {
          status: IngestionStatus.failed,
          finishedAt: now,
          errors: { increment: 1 },
          logs: {
            recoveredBy: "jobs_scheduler",
            reason: "stale_run_timeout",
            previousStatus: run.status,
            staleSince: (run.startedAt ?? run.createdAt).toISOString()
          }
        }
      });
    }

    this.logger.warn(`Recovered ${staleRuns.length} stale ingestion run(s)`);
  }
}
