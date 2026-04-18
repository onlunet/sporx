import { IngestionQueueService } from "./ingestion-queue.service";

describe("IngestionQueueService", () => {
  const runtimeSecurity = {
    validateQueuePayload: jest.fn(async ({ queueName, jobName, payload, serviceIdentityId }: any) => ({
      queueName,
      jobName,
      payload: { ...payload, serviceIdentityId: serviceIdentityId ?? "api" },
      serviceIdentityId: serviceIdentityId ?? "api"
    })),
    quarantinePoisonJob: jest.fn().mockResolvedValue(undefined)
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("enqueues jobs", async () => {
    const queue = {
      add: jest.fn().mockResolvedValue({ id: "job-1" }),
      getJob: jest.fn().mockResolvedValue(null)
    } as any;
    const service = new IngestionQueueService(
      queue,
      {
        duplicateSuppressionStat: { upsert: jest.fn().mockResolvedValue({ id: "dup-1" }) }
      } as any,
      { invalidateTag: jest.fn() } as any,
      { sync: jest.fn().mockResolvedValue({ recordsRead: 0, recordsWritten: 0, errors: 0, logs: {} }) } as any,
      runtimeSecurity as any
    );
    const result = await service.enqueue("syncFixtures", { runId: "run-1" });
    expect(result.id).toBe("job-1");
  });

  it("keeps last live job payload active when dedup key matches", async () => {
    const activeJob = {
      id: "live-job-1",
      getState: jest.fn().mockResolvedValue("active"),
      updateData: jest.fn().mockResolvedValue(undefined)
    };
    const queue = {
      add: jest.fn().mockResolvedValue({ id: "job-2" }),
      getJob: jest.fn().mockResolvedValue(activeJob)
    } as any;
    const service = new IngestionQueueService(
      queue,
      {
        duplicateSuppressionStat: { upsert: jest.fn().mockResolvedValue({ id: "dup-2" }) }
      } as any,
      { invalidateTag: jest.fn() } as any,
      { sync: jest.fn().mockResolvedValue({ recordsRead: 0, recordsWritten: 0, errors: 0, logs: {} }) } as any,
      runtimeSecurity as any
    );

    const result = await service.enqueue("predictionRun", {
      runId: "run-2",
      matchId: "m-1",
      market: "match_outcome",
      line: null,
      horizon: "LIVE_16_30",
      payloadVersion: 2
    });

    expect(queue.getJob).toHaveBeenCalledWith("match:m-1:market:match_outcome:line:na:h:LIVE_16_30");
    expect(activeJob.updateData).toHaveBeenCalledWith(
      expect.objectContaining({
        dedupKey: "match:m-1:market:match_outcome:line:na:h:LIVE_16_30",
        keepLastIfActive: true
      })
    );
    expect(queue.add).not.toHaveBeenCalled();
    expect(result).toBe(activeJob);
  });

  it("enqueues ingestion pipeline as a single executable job type", async () => {
    const queue = {
      add: jest.fn(),
      getJob: jest.fn().mockResolvedValue(null)
    } as any;
    const service = new IngestionQueueService(
      queue,
      {
        duplicateSuppressionStat: { upsert: jest.fn().mockResolvedValue({ id: "dup-3" }) }
      } as any,
      { invalidateTag: jest.fn() } as any,
      { sync: jest.fn().mockResolvedValue({ recordsRead: 0, recordsWritten: 0, errors: 0, logs: {} }) } as any,
      runtimeSecurity as any
    );

    const add = jest.fn().mockResolvedValue({ job: { id: "flow-1" } });
    jest.spyOn(service as any, "getFlowProducer").mockReturnValue({ add });

    await service.enqueuePipeline("syncFixtures", {
      runId: "run-3",
      jobType: "syncFixtures"
    });

    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "syncFixtures",
        queueName: "ingestion",
        opts: expect.objectContaining({
          jobId: "run:run-3:syncFixtures"
        })
      })
    );
  });
});
