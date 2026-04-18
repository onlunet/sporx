import { ModelLifecycleOrchestrationService } from "./model-lifecycle-orchestration.service";

describe("ModelLifecycleOrchestrationService queue security", () => {
  const queue = {
    upsertJobScheduler: jest.fn().mockResolvedValue(undefined)
  } as any;
  const prisma = {} as any;
  const cache = {
    acquireLock: jest.fn().mockResolvedValue(false),
    releaseLock: jest.fn().mockResolvedValue(undefined)
  } as any;
  const modelAliasService = {
    lineKey: jest.fn((line: number | null) => (line === null ? "na" : line.toFixed(2))),
    scopeLeagueKey: jest.fn((leagueId: string | null) => (leagueId ? leagueId : "global"))
  } as any;

  const internalRuntimeSecurityService = {
    resolveServiceIdentity: jest.fn(() => "model-lifecycle-worker"),
    validateQueuePayload: jest.fn(async ({ payload, queueName, jobName, mode, serviceIdentityId }: any) => ({
      queueName,
      jobName,
      mode,
      serviceIdentityId: serviceIdentityId ?? "model-lifecycle-worker",
      payload: {
        ...payload,
        authority: payload.authority ?? "internal",
        serviceIdentityId: serviceIdentityId ?? payload.serviceIdentityId ?? "model-lifecycle-worker"
      }
    }))
  } as any;

  function createService() {
    return new ModelLifecycleOrchestrationService(
      queue,
      prisma,
      cache,
      modelAliasService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      internalRuntimeSecurityService
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("validates queue payloads in enqueue path", async () => {
    const service = createService();
    (service as any).flowProducer = {
      add: jest.fn().mockResolvedValue({ id: "flow-1" })
    };

    await service.enqueueLifecycleFlow(
      {
        sport: "football",
        market: "match_winner",
        horizon: "PRE24",
        line: null,
        leagueId: null
      },
      {
        windowStart: new Date("2026-01-01T00:00:00.000Z"),
        windowEnd: new Date("2026-02-01T00:00:00.000Z"),
        actor: "system"
      }
    );

    expect(internalRuntimeSecurityService.validateQueuePayload).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: "model-lifecycle",
        mode: "enqueue"
      })
    );
  });

  it("validates queue payloads in process path", async () => {
    const service = createService();
    jest.spyOn(service as any, "processJob").mockResolvedValue(undefined);

    await (service as any).processQueuedJob("collectLabels", {
      runId: "run-1",
      authority: "internal",
      serviceIdentityId: "model-lifecycle-worker",
      dedupKey: "dedup-1",
      sport: "football",
      market: "match_winner",
      line: null,
      lineKey: "na",
      horizon: "PRE24",
      leagueId: null,
      scopeLeagueKey: "global",
      windowStart: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      windowEnd: new Date("2026-02-01T00:00:00.000Z").toISOString(),
      actor: "system"
    });

    expect(internalRuntimeSecurityService.validateQueuePayload).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: "model-lifecycle",
        mode: "process",
        jobName: "collectLabels"
      })
    );
  });

  it("rejects public-authority payloads", async () => {
    internalRuntimeSecurityService.validateQueuePayload.mockImplementationOnce(async ({ payload }: any) => {
      if (payload?.authority === "public") {
        throw new Error("Public authority cannot trigger privileged queue jobs");
      }
      return {
        queueName: "model-lifecycle",
        jobName: "collectLabels",
        serviceIdentityId: "model-lifecycle-worker",
        payload
      };
    });

    const service = createService();
    await expect(
      (service as any).validateLifecyclePayload(
        "collectLabels",
        {
          runId: "run-public",
          authority: "public",
          dedupKey: "dedup-public"
        },
        "process"
      )
    ).rejects.toThrow("Public authority cannot trigger privileged queue jobs");
  });
});
