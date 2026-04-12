import { IngestionQueueService } from "./ingestion-queue.service";

describe("IngestionQueueService", () => {
  it("enqueues jobs", async () => {
    const queue = { add: jest.fn().mockResolvedValue({ id: "job-1" }) } as any;
    const service = new IngestionQueueService(
      queue,
      {} as any,
      { invalidateTag: jest.fn() } as any,
      { sync: jest.fn().mockResolvedValue({ recordsRead: 0, recordsWritten: 0, errors: 0, logs: {} }) } as any
    );
    const result = await service.enqueue("syncFixtures", { runId: "run-1" });
    expect(result.id).toBe("job-1");
  });
});
