import { IngestionService } from "./ingestion.service";

describe("IngestionService", () => {
  const makeRun = () => ({
    id: "run-1",
    jobType: "syncFixtures",
    status: "queued",
    startedAt: null,
    finishedAt: null,
    recordsRead: 0,
    recordsWritten: 0,
    errors: 0
  });

  it("enqueues pipeline and schedules inline fallback", async () => {
    const queue = {
      enqueuePipeline: jest.fn().mockResolvedValue(undefined),
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

    await service.run("syncFixtures");

    expect(queue.enqueuePipeline).toHaveBeenCalledWith("syncFixtures", {
      runId: "run-1",
      jobType: "syncFixtures"
    });
    expect(queue.runInlineFallback).toHaveBeenCalledWith("run-1", "syncFixtures");
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
});
