import { JobsService } from "./jobs.service";

describe("JobsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SERVICE_ROLE = "worker";
    delete process.env.INGESTION_RUNNING_MAX_AGE_MS;
  });

  it("schedules syncResults automatically with new football-data cadence jobs", async () => {
    const prisma = {
      ingestionJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "job-1" })
      },
      ingestionJobRun: {
        findMany: jest.fn(async (args: any) => {
          if (args?.where?.status) {
            return [];
          }
          return [];
        }),
        update: jest.fn().mockResolvedValue(undefined)
      },
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([])
      },
      match: {
        count: jest.fn().mockResolvedValueOnce(12).mockResolvedValueOnce(3)
      }
    };
    const ingestionService = {
      run: jest.fn(async (jobType: string) => ({
        id: `run-${jobType}`
      }))
    };
    const cacheService = {
      acquireLock: jest.fn().mockResolvedValue(true),
      renewLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined)
    };

    const service = new JobsService(prisma as any, ingestionService as any, cacheService as any);
    await (service as any).tick("interval");

    const scheduledJobTypes = ingestionService.run.mock.calls.map((call) => call[0]);
    expect(scheduledJobTypes).toContain("syncResults");
    expect(scheduledJobTypes).toContain("syncFixturesHotPulse");
    expect(scheduledJobTypes).toContain("syncResultsReconcile");
  });

  it("keeps scheduler active for api role by default", async () => {
    process.env.SERVICE_ROLE = "api";
    delete process.env.SCHEDULER_ENABLED;

    const prisma = {
      ingestionJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "job-1" })
      },
      ingestionJobRun: {
        findMany: jest.fn(async (args: any) => {
          if (args?.where?.status) {
            return [];
          }
          return [];
        }),
        update: jest.fn().mockResolvedValue(undefined)
      },
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([])
      },
      match: {
        count: jest.fn().mockResolvedValueOnce(4).mockResolvedValueOnce(1)
      }
    };
    const ingestionService = {
      run: jest.fn(async (jobType: string) => ({ id: `run-${jobType}` }))
    };
    const cacheService = {
      acquireLock: jest.fn().mockResolvedValue(true),
      renewLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined)
    };

    const service = new JobsService(prisma as any, ingestionService as any, cacheService as any);
    await service.onModuleInit();
    await service.onModuleDestroy();

    expect(ingestionService.run).toHaveBeenCalled();
  });

  it("recovers long-running jobs even when heartbeat keeps startedAt fresh", async () => {
    process.env.INGESTION_RUNNING_MAX_AGE_MS = String(30 * 60 * 1000);
    const prisma = {
      ingestionJob: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "job-1" })
      },
      ingestionJobRun: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "run-stuck",
            status: "running",
            createdAt: new Date(Date.now() - 40 * 60 * 1000),
            startedAt: new Date(Date.now() - 30 * 1000)
          }
        ]),
        update: jest.fn().mockResolvedValue(undefined)
      },
      systemSetting: {
        findMany: jest.fn().mockResolvedValue([])
      },
      match: {
        count: jest.fn().mockResolvedValue(0)
      }
    };
    const ingestionService = {
      run: jest.fn()
    };
    const cacheService = {
      acquireLock: jest.fn().mockResolvedValue(true),
      renewLock: jest.fn().mockResolvedValue(true),
      releaseLock: jest.fn().mockResolvedValue(undefined)
    };

    const service = new JobsService(prisma as any, ingestionService as any, cacheService as any);
    await (service as any).recoverStaleRuns();

    expect(prisma.ingestionJobRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-stuck" },
        data: expect.objectContaining({
          status: "failed",
          logs: expect.objectContaining({
            reason: "max_running_age_exceeded",
            previousStatus: "running"
          })
        })
      })
    );
  });
});
