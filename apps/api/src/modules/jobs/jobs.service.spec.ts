import { JobsService } from "./jobs.service";

describe("JobsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SERVICE_ROLE = "worker";
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
});
