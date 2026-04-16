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
  private readonly tickMs = this.readSchedulerTickMs();
  private readonly staleThresholdMs = this.readStaleThresholdMs();
  private readonly staleRecoveryIntervalMs = this.readStaleRecoveryIntervalMs();
  private readonly schedulerLockKey = process.env.SCHEDULER_LOCK_KEY ?? "jobs-scheduler";
  private readonly schedulerLockOwner = `${process.env.HOSTNAME ?? "worker"}:${process.pid}`;
  private readonly schedulerLockTtlMs = this.readSchedulerLockTtlMs();
  private timer: NodeJS.Timeout | null = null;
  private isTicking = false;
  private lastStaleRecoveryAt = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestionService: IngestionService,
    private readonly cacheService: CacheService
  ) {}

  async onModuleInit() {
    if (!this.isWorker) {
      return;
    }

    await this.recoverStaleRunsIfDue(true);
    await this.ensureDefaultJobs();
    await this.safeTick("startup");

    this.timer = setInterval(() => {
      void this.safeTick("interval");
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
      await this.recoverStaleRunsIfDue(reason === "startup");

      const { syncEveryMinutes, intervals } = await this.resolveScheduleIntervals();
      const latestRunsByType = await this.loadLatestRunsByType();
      const forceOnStartup = reason === "startup";

      await this.ensureRecentRun("syncFixtures", syncEveryMinutes, forceOnStartup, latestRunsByType.get("syncFixtures"));
      await this.ensureRecentRun(
        "syncStandings",
        intervals.standingsMinutes,
        forceOnStartup,
        latestRunsByType.get("syncStandings")
      );
      await this.ensureRecentRun(
        "generatePredictions",
        syncEveryMinutes,
        forceOnStartup,
        latestRunsByType.get("generatePredictions")
      );
      await this.ensureRecentRun(
        "providerHealthCheck",
        intervals.providerHealthMinutes,
        forceOnStartup,
        latestRunsByType.get("providerHealthCheck")
      );
      await this.ensureRecentRun(
        "syncOddsPreMatch",
        intervals.oddsPreMatchMinutes,
        forceOnStartup,
        latestRunsByType.get("syncOddsPreMatch")
      );
      await this.ensureRecentRun(
        "syncOddsLive",
        intervals.oddsLiveMinutes,
        forceOnStartup,
        latestRunsByType.get("syncOddsLive")
      );
      await this.ensureRecentRun(
        "syncOddsClosing",
        intervals.oddsClosingMinutes,
        forceOnStartup,
        latestRunsByType.get("syncOddsClosing")
      );
      await this.ensureRecentRun(
        "generateMarketAnalysis",
        intervals.marketAnalysisMinutes,
        forceOnStartup,
        latestRunsByType.get("generateMarketAnalysis")
      );
      await this.ensureRecentRun(
        "resolveProviderAliases",
        intervals.aliasSyncMinutes,
        forceOnStartup,
        latestRunsByType.get("resolveProviderAliases")
      );
      await this.ensureRecentRun(
        "enrichTeamProfiles",
        intervals.teamProfileMinutes,
        forceOnStartup,
        latestRunsByType.get("enrichTeamProfiles")
      );
      await this.ensureRecentRun(
        "enrichMatchDetails",
        intervals.detailMinutes,
        forceOnStartup,
        latestRunsByType.get("enrichMatchDetails")
      );
    } catch (error) {
      this.logger.error(
        "Scheduler tick failed; will retry next cycle",
        error instanceof Error ? error.stack : undefined
      );
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

  private async resolveScheduleIntervals() {
    const intervalKeys = [
      "sync.interval.defaultMinutes",
      "sync.interval.matchDayMinutes",
      "sync.interval.standingsMinutes",
      "sync.interval.aliasMinutes",
      "sync.interval.teamProfileMinutes",
      "sync.interval.matchDetailMinutes",
      "sync.interval.providerHealthMinutes",
      "sync.interval.oddsPreMatchMinutes",
      "sync.interval.oddsLiveMinutes",
      "sync.interval.oddsClosingMinutes",
      "sync.interval.marketAnalysisMinutes"
    ] as const;

    const [settings, nextDayMatches] = await Promise.all([
      this.prisma.systemSetting.findMany({
        where: {
          key: { in: [...intervalKeys] }
        }
      }),
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

    const settingMap = new Map(settings.map((setting) => [setting.key, setting.value] as const));
    const defaultMinutes = this.settingNumber(settingMap.get("sync.interval.defaultMinutes"), 60);
    const matchDayMinutes = this.settingNumber(settingMap.get("sync.interval.matchDayMinutes"), 15);

    return {
      syncEveryMinutes: nextDayMatches > 0 ? matchDayMinutes : defaultMinutes,
      intervals: {
        standingsMinutes: this.settingNumber(settingMap.get("sync.interval.standingsMinutes"), 360),
        aliasSyncMinutes: this.settingNumber(settingMap.get("sync.interval.aliasMinutes"), 360),
        teamProfileMinutes: this.settingNumber(settingMap.get("sync.interval.teamProfileMinutes"), 240),
        detailMinutes: this.settingNumber(settingMap.get("sync.interval.matchDetailMinutes"), 120),
        providerHealthMinutes: this.settingNumber(settingMap.get("sync.interval.providerHealthMinutes"), 30),
        oddsPreMatchMinutes: this.settingNumber(settingMap.get("sync.interval.oddsPreMatchMinutes"), 30),
        oddsLiveMinutes: this.settingNumber(settingMap.get("sync.interval.oddsLiveMinutes"), 5),
        oddsClosingMinutes: this.settingNumber(settingMap.get("sync.interval.oddsClosingMinutes"), 20),
        marketAnalysisMinutes: this.settingNumber(settingMap.get("sync.interval.marketAnalysisMinutes"), 20)
      }
    };
  }

  private async loadLatestRunsByType() {
    const latestRuns = await this.prisma.ingestionJobRun.findMany({
      where: {
        jobType: { in: [...JOB_TYPES] }
      },
      orderBy: [{ jobType: "asc" }, { createdAt: "desc" }],
      distinct: ["jobType"]
    });
    return new Map(latestRuns.map((run) => [run.jobType as JobType, run] as const));
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

  private readSchedulerTickMs() {
    const raw = process.env.SCHEDULER_TICK_MS;
    const fallback = 180_000;
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 30_000) {
      return fallback;
    }

    return Math.round(parsed);
  }

  private readStaleRecoveryIntervalMs() {
    const raw = process.env.SCHEDULER_STALE_RECOVERY_INTERVAL_MS;
    const fallback = 300_000;
    if (!raw) {
      return fallback;
    }

    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 60_000) {
      return fallback;
    }

    return Math.round(parsed);
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

  private async ensureRecentRun(
    jobType: JobType,
    maxAgeMinutes: number,
    forceOnStartup: boolean,
    latest: {
      id: string;
      status: IngestionStatus;
      createdAt: Date;
      startedAt: Date | null;
      finishedAt: Date | null;
    } | undefined
  ) {
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

  private async recoverStaleRunsIfDue(force = false) {
    const now = Date.now();
    if (!force && now - this.lastStaleRecoveryAt < this.staleRecoveryIntervalMs) {
      return;
    }
    this.lastStaleRecoveryAt = now;
    await this.recoverStaleRuns();
  }

  private async safeTick(reason: "startup" | "interval") {
    try {
      await this.tick(reason);
    } catch (error) {
      this.logger.error(
        "Unexpected scheduler error escaped tick()",
        error instanceof Error ? error.stack : undefined
      );
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
