import { PublishDecisionStatus } from "@prisma/client";
import { BankrollOrchestrationService } from "./bankroll-orchestration.service";

describe("BankrollOrchestrationService queue security", () => {
  const queue = {} as any;
  const prisma = {} as any;
  const cache = {} as any;
  const configService = {
    getSettings: jest.fn(),
    resolvePrimaryAccount: jest.fn(),
    resolveActivePolicyVersion: jest.fn()
  } as any;

  const internalRuntimeSecurityService = {
    resolveServiceIdentity: jest.fn(() => "bankroll-worker"),
    validateQueuePayload: jest.fn(async ({ payload, queueName, jobName, mode, serviceIdentityId }: any) => ({
      queueName,
      jobName,
      mode,
      serviceIdentityId: serviceIdentityId ?? "bankroll-worker",
      payload: {
        ...payload,
        authority: payload.authority ?? "internal",
        serviceIdentityId: serviceIdentityId ?? payload.serviceIdentityId ?? "bankroll-worker"
      }
    }))
  } as any;

  function createService() {
    return new BankrollOrchestrationService(
      queue,
      prisma,
      cache,
      configService,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      internalRuntimeSecurityService
    );
  }

  function approvedSelection() {
    return {
      sportCode: "football",
      matchId: "match-1",
      leagueId: "league-1",
      market: "match_winner",
      line: null,
      horizon: "PRE24",
      selection: "home",
      predictionRunId: "run-1",
      modelVersionId: "model-1",
      calibrationVersionId: "cal-1",
      publishedPredictionId: "pub-1",
      publishDecisionId: "dec-1",
      publishDecisionStatus: PublishDecisionStatus.APPROVED,
      calibratedProbability: 0.62,
      fairOdds: 1.7,
      offeredOdds: 1.8,
      edge: 0.02,
      confidence: 0.75,
      publishScore: 0.8,
      freshnessScore: 0.85,
      coverageFlags: {},
      volatilityScore: 0.1,
      providerDisagreement: 0.05
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    configService.getSettings.mockResolvedValue({
      bankrollLayerEnabled: true,
      emergencyKillSwitch: false,
      stakingProfileDefault: null
    });
    configService.resolvePrimaryAccount.mockResolvedValue({
      id: "account-1",
      profileDefault: "CONSERVATIVE"
    });
    configService.resolveActivePolicyVersion.mockResolvedValue({ id: "policy-1" });
  });

  it("validates queue payloads in enqueue path", async () => {
    const service = createService();
    (service as any).flowProducer = {
      add: jest.fn().mockResolvedValue({ id: "flow-1" })
    };

    await service.processPublishedSelection(approvedSelection());

    expect(internalRuntimeSecurityService.validateQueuePayload).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: "bankroll",
        mode: "enqueue"
      })
    );
  });

  it("validates queue payloads in process path during inline fallback", async () => {
    const service = createService();
    (service as any).flowProducer = {
      add: jest.fn().mockRejectedValue(new Error("queue unavailable"))
    };
    jest.spyOn(service as any, "processStage").mockResolvedValue(undefined);

    await service.processPublishedSelection(approvedSelection());

    expect(internalRuntimeSecurityService.validateQueuePayload).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: "bankroll",
        mode: "process"
      })
    );
  });

  it("rejects public-authority payloads", async () => {
    internalRuntimeSecurityService.validateQueuePayload.mockImplementationOnce(async ({ payload }: any) => {
      if (payload?.authority === "public") {
        throw new Error("Public authority cannot trigger privileged queue jobs");
      }
      return {
        queueName: "bankroll",
        jobName: "stakeCandidateBuild",
        serviceIdentityId: "bankroll-worker",
        payload
      };
    });

    const service = createService();
    await expect(
      (service as any).validateStagePayload(
        "stakeCandidateBuild",
        {
          runId: "run-public",
          authority: "public",
          dedupBaseKey: "dedup-public"
        },
        "process"
      )
    ).rejects.toThrow("Public authority cannot trigger privileged queue jobs");
  });
});
