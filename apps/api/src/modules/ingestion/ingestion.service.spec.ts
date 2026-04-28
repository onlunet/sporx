import { IngestionService } from "./ingestion.service";

describe("IngestionService", () => {
  const makeRun = (jobType = "syncFixtures") => ({
    id: "run-1",
    jobType,
    status: "queued",
    startedAt: null,
    finishedAt: null,
    recordsRead: 0,
    recordsWritten: 0,
    errors: 0
  });

  it("enqueues pipeline without inline fallback when queue is healthy", async () => {
    const queue = {
      enqueuePipeline: jest.fn().mockResolvedValue(undefined),
      runInlineFallback: jest.fn(),
      runInlineFallbackAfter: jest.fn()
    };
    const prisma = {
      ingestionJob: {
        findFirst: jest.fn().mockResolvedValue({ id: "job-1" }),
        create: jest.fn()
      },
      ingestionJobRun: {
        create: jest.fn().mockResolvedValue(makeRun())
      }
    };
    const service = new IngestionService(prisma as any, queue as any, {} as any);

    await service.run("syncFixtures");

    expect(queue.enqueuePipeline).toHaveBeenCalledWith("syncFixtures", {
      runId: "run-1",
      jobType: "syncFixtures"
    });
    expect(queue.runInlineFallback).not.toHaveBeenCalled();
    expect(queue.runInlineFallbackAfter).not.toHaveBeenCalled();
  });

  it("schedules delayed inline fallback for generatePredictions when queue accepts the run", async () => {
    const queue = {
      enqueuePipeline: jest.fn().mockResolvedValue(undefined),
      runInlineFallback: jest.fn(),
      runInlineFallbackAfter: jest.fn()
    };
    const prisma = {
      ingestionJob: {
        findFirst: jest.fn().mockResolvedValue({ id: "job-1" }),
        create: jest.fn()
      },
      ingestionJobRun: {
        create: jest.fn().mockResolvedValue(makeRun("generatePredictions"))
      }
    };
    const service = new IngestionService(prisma as any, queue as any, {} as any);

    await service.run("generatePredictions");

    expect(queue.enqueuePipeline).toHaveBeenCalledWith("generatePredictions", {
      runId: "run-1",
      jobType: "generatePredictions"
    });
    expect(queue.runInlineFallback).not.toHaveBeenCalled();
    expect(queue.runInlineFallbackAfter).toHaveBeenCalledWith("run-1", "generatePredictions", 60000);
  });

  it("keeps inline fallback when enqueue fails", async () => {
    const queue = {
      enqueuePipeline: jest.fn().mockRejectedValue(new Error("redis unavailable")),
      runInlineFallback: jest.fn()
    };
    const prisma = {
      ingestionJob: {
        findFirst: jest.fn().mockResolvedValue({ id: "job-1" }),
        create: jest.fn()
      },
      ingestionJobRun: {
        create: jest.fn().mockResolvedValue(makeRun())
      }
    };
    const service = new IngestionService(prisma as any, queue as any, {} as any);

    const result = await service.run("syncFixtures");

    expect(result.id).toBe("run-1");
    expect(queue.enqueuePipeline).toHaveBeenCalledTimes(1);
    expect(queue.runInlineFallback).toHaveBeenCalledWith("run-1", "syncFixtures");
  });

  it("falls back to direct provider sync when ingestion tables are missing", async () => {
    const queue = {
      enqueuePipeline: jest.fn(),
      runInlineFallback: jest.fn()
    };
    const prisma = {
      ingestionJob: {
        findFirst: jest.fn().mockRejectedValue(new Error("relation ingestion_jobs does not exist")),
        create: jest.fn()
      },
      ingestionJobRun: {
        create: jest.fn()
      }
    };
    const providerIngestionService = {
      sync: jest.fn().mockResolvedValue({
        recordsRead: 12,
        recordsWritten: 7,
        errors: 0,
        logs: { provider: "football_data" }
      })
    };

    const service = new IngestionService(prisma as any, queue as any, providerIngestionService as any);
    const result = await service.run("syncFixtures");

    expect(providerIngestionService.sync).toHaveBeenCalledWith("syncFixtures", expect.stringMatching(/^compat-syncFixtures-/));
    expect(result.status).toBe("succeeded");
    expect(result.recordsWritten).toBe(7);
  });

  it("returns empty run list when ingestion run table is missing", async () => {
    const queue = {
      enqueuePipeline: jest.fn(),
      runInlineFallback: jest.fn()
    };
    const prisma = {
      ingestionJob: {
        findFirst: jest.fn(),
        create: jest.fn()
      },
      ingestionJobRun: {
        findMany: jest.fn().mockRejectedValue(new Error("relation ingestion_job_runs does not exist"))
      }
    };
    const service = new IngestionService(prisma as any, queue as any, { sync: jest.fn() } as any);

    await expect(service.listRuns()).resolves.toEqual([]);
  });

  it("extends halftime backfill with detail enrichment run", async () => {
    const queue = {
      enqueuePipeline: jest.fn().mockResolvedValue(undefined),
      runInlineFallback: jest.fn(),
      runInlineFallbackAfter: jest.fn()
    };
    const prisma = {
      ingestionJob: {
        findFirst: jest.fn().mockResolvedValue({ id: "job-1" }),
        create: jest.fn()
      },
      ingestionJobRun: {
        create: jest
          .fn()
          .mockResolvedValueOnce(makeRun("syncResults"))
          .mockResolvedValueOnce(makeRun("enrichMatchDetails"))
      }
    };
    const providerIngestionService = {
      rewindFootballResultsCheckpoints: jest.fn().mockResolvedValue({ rewound: 42 })
    };

    const service = new IngestionService(prisma as any, queue as any, providerIngestionService as any);
    const result = await service.runHalfTimeBackfill(30);

    expect(providerIngestionService.rewindFootballResultsCheckpoints).toHaveBeenCalledWith(30);
    expect(queue.enqueuePipeline).toHaveBeenNthCalledWith(1, "syncResults", {
      runId: "run-1",
      jobType: "syncResults"
    });
    expect(queue.enqueuePipeline).toHaveBeenNthCalledWith(2, "enrichMatchDetails", {
      runId: "run-1",
      jobType: "enrichMatchDetails"
    });
    expect(result).toHaveProperty("detailEnrichment");
  });
});
