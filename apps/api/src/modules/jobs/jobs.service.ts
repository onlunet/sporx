import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { IngestionStatus } from "@prisma/client";
import { CacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import { IngestionService } from "../ingestion/ingestion.service";

type JobType =
  | "syncFixtures"
  | "syncFixturesHotPulse"
  | "syncResults"
  | "syncResultsReconcile"
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
];

type SchedulerLockState = {
  lost: boolean;
};

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  // Run scheduler by default when SERVICE_ROLE is missing; explicit SERVICE_ROLE=api can still disable it.
  private readonly isWorker = (process.env.SERVICE_ROLE ?? "worker") === "worker";
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

    const lockState: SchedulerLockState = { lost: false };
    const stopLockHeartbeat = this.startSchedulerLockHeartbeat(lockState);

    try {
      await this.recoverStaleRunsIfDue(reason === "startup");
      this.assertSchedulerLockHeld(lockState);

      const { syncEveryMinutes, intervals } = await this.resolveScheduleIntervals();
      this.assertSchedulerLockHeld(lockState);
      const latestRunsByType = await this.loadLatestRunsByType();
      this.assertSchedulerLockHeld(lockState);
      const forceOnStartup = reason === "startup";

      const schedulePlan: Array<readonly [JobType, number]> = [
        ["syncFixtures", syncEveryMinutes],
        ["syncFixturesHotPulse", intervals.hotPulseMinutes],
        ["syncResults", intervals.resultsMinutes],
        ["syncResultsReconcile", intervals.resultsReconcileMinutes],
        ["syncStandings", intervals.standingsMinutes],
        ["generatePredictions", syncEveryMinutes],
        ["providerHealthCheck", intervals.providerHealthMinutes],
        ["syncOddsPreMatch", intervals.oddsPreMatchMinutes],
        ["syncOddsLive", intervals.oddsLiveMinutes],
        ["syncOddsClosing", intervals.oddsClosingMinutes],
        ["generateMarketAnalysis", intervals.marketAnalysisMinutes],
        ["resolveProviderAliases", intervals.aliasSyncMinutes],
        ["enrichTeamProfiles", intervals.teamProfileMinutes],
        ["enrichMatchDetails", intervals.detailMinutes]
      ];

      for (const [jobType, maxAgeMinutes] of schedulePlan) {
        this.assertSchedulerLockHeld(lockState);
        await this.ensureRecentRun(jobType, maxAgeMinutes, forceOnStartup, latestRunsByType.get(jobType));
      }
    } catch (error) {
      if (error instanceof Error && error.message === "scheduler_lock_lost") {
        this.logger.warn("Scheduler lock lost during tick; skipping remaining cycle");
      } else {
        this.logger.error(
          "Scheduler tick failed; will retry next cycle",
          error instanceof Error ? error.stack : undefined
        );
      }
    } finally {
      await stopLockHeartbeat();
      await this.cacheService.releaseLock(this.schedulerLockKey, this.schedulerLockOwner);
      this.isTicking = false;
    }
  }

  private startSchedulerLockHeartbeat(lockState: SchedulerLockState) {
    const renewEveryMs = Math.max(1_000, Math.floor(this.schedulerLockTtlMs / 3));
    let stopped = false;
    let inFlight: Promise<void> | null = null;

    const timer = setInterval(() => {
      if (stopped || lockState.lost) {
        return;
      }
      inFlight = this.renewSchedulerLock(lockState);
    }, renewEveryMs);

    return async () => {
      stopped = true;
      clearInterval(timer);
      if (inFlight) {
        await inFlight.catch(() => undefined);
      }
    };
  }

  private async renewSchedulerLock(lockState: SchedulerLockState) {
    if (lockState.lost) {
      return;
    }
    try {
      const renewed = await this.cacheService.renewLock(
        this.schedulerLockKey,
        this.schedulerLockOwner,
        this.schedulerLockTtlMs
      );
      if (!renewed) {
        lockState.lost = true;
      }
    } catch {
      lockState.lost = true;
    }

    if (lockState.lost) {
      this.logger.warn("Scheduler lock renewal failed; skipping remaining work in current cycle");
    }
  }

  private assertSchedulerLockHeld(lockState: SchedulerLockState) {
    if (lockState.lost) {
      throw new Error("scheduler_lock_lost");
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
      "sync.interval.hotPulseMinutes",
      "sync.interval.resultsMinutes",
      "sync.interval.resultsReconcileMinutes",
      "sync.interval.standingsHotMinutes",
      "sync.interval.standingsQuietMinutes",
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

    const [settings, nextDayMatches, hotFootballMatches] = await Promise.all([
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
      }),
      this.prisma.match.count({
        where: {
          sport: { code: "football" },
          OR: [
            { status: "live" },
            {
              status: "scheduled",
              matchDateTimeUTC: {
                gte: new Date(),
                lte: new Date(Date.now() + 6 * 60 * 60 * 1000)
              }
            }
          ]
        }
      })
    ]);

    const settingMap = new Map(settings.map((setting) => [setting.key, setting.value] as const));
    const defaultMinutes = this.settingNumber(settingMap.get("sync.interval.defaultMinutes"), 60);
    const matchDayMinutes = this.settingNumber(settingMap.get("sync.interval.matchDayMinutes"), 5);
    const standingsHotMinutes = this.settingNumber(
      settingMap.get("sync.interval.standingsHotMinutes") ?? settingMap.get("sync.interval.standingsMinutes"),
      360
    );
    const standingsQuietMinutes = this.settingNumber(settingMap.get("sync.interval.standingsQuietMinutes"), 720);

    return {
      syncEveryMinutes: nextDayMatches > 0 ? matchDayMinutes : defaultMinutes,
      intervals: {
        hotPulseMinutes: hotFootballMatches > 0 ? this.settingNumber(settingMap.get("sync.interval.hotPulseMinutes"), 3) : 30,
        resultsMinutes: this.settingNumber(settingMap.get("sync.interval.resultsMinutes"), 30),
        resultsReconcileMinutes: this.settingNumber(settingMap.get("sync.interval.resultsReconcileMinutes"), 1440),
        standingsMinutes: hotFootballMatches > 0 ? standingsHotMinutes : standingsQuietMinutes,
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
