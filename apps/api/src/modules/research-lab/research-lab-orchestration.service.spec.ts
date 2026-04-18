import { TuningSearchType } from "@prisma/client";
import { ResearchLabOrchestrationService } from "./research-lab-orchestration.service";

describe("ResearchLabOrchestrationService", () => {
  const queue = {} as any;
  const prisma = {} as any;
  const configService = {
    getSettings: jest.fn()
  } as any;
  const trackingService = {
    createOrUpdateRun: jest.fn()
  } as any;
  const tuningEngineService = {} as any;
  const objectiveFunctionService = {} as any;
  const trialPruningService = {} as any;
  const robustnessCheckService = {} as any;
  const segmentScorecardService = {} as any;
  const candidateRegistry = {} as any;
  const promotionGateService = {} as any;
  const internalRuntimeSecurityService = {
    resolveServiceIdentity: jest.fn(() => "research-lab-worker"),
    validateQueuePayload: jest.fn(async ({ payload, queueName, jobName, mode, serviceIdentityId }: any) => ({
      queueName,
      jobName,
      serviceIdentityId: serviceIdentityId ?? "research-lab-worker",
      payload: {
        ...payload,
        authority: payload.authority ?? "internal",
        serviceIdentityId: serviceIdentityId ?? payload.serviceIdentityId ?? "research-lab-worker"
      }
    }))
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("keeps research queue isolated from live queues", () => {
    const service = new ResearchLabOrchestrationService(
      queue,
      prisma,
      configService,
      trackingService,
      tuningEngineService,
      objectiveFunctionService,
      trialPruningService,
      robustnessCheckService,
      segmentScorecardService,
      candidateRegistry,
      promotionGateService,
      internalRuntimeSecurityService
    );

    expect(service.queueName()).toBe("research-lab");
    expect(service.stages()).toEqual([
      "freezeDataset",
      "generateConfigSet",
      "runTrial",
      "simulateTrial",
      "aggregateTrialMetrics",
      "runRobustnessChecks",
      "registerPolicyCandidate",
      "evaluatePromotionGate",
      "exportArtifacts"
    ]);
  });

  it("does not mutate runtime flow when research lab disabled", async () => {
    configService.getSettings.mockResolvedValue({
      researchLabEnabled: false,
      autoTuningEnabled: false,
      trialPruningEnabled: true,
      policyCandidateRegistryEnabled: true,
      policyShadowPromotionEnabled: false,
      policyCanaryPromotionEnabled: false
    });
    const service = new ResearchLabOrchestrationService(
      queue,
      prisma,
      configService,
      trackingService,
      tuningEngineService,
      objectiveFunctionService,
      trialPruningService,
      robustnessCheckService,
      segmentScorecardService,
      candidateRegistry,
      promotionGateService,
      internalRuntimeSecurityService
    );

    const result = await service.enqueueResearchFlow({
      projectId: "project-1",
      experimentId: "exp-1",
      rangeStart: new Date("2026-01-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-02-01T00:00:00.000Z"),
      sport: "football",
      objectiveMetric: "roi",
      datasetHashes: { feature: "hash-1" },
      seed: 42,
      searchType: TuningSearchType.RANDOM
    });

    expect(result).toEqual({
      queued: false,
      reason: "research_lab_disabled"
    });
    expect(trackingService.createOrUpdateRun).not.toHaveBeenCalled();
  });

  it("validates queue payloads during enqueue", async () => {
    configService.getSettings.mockResolvedValue({
      researchLabEnabled: true,
      autoTuningEnabled: true,
      trialPruningEnabled: true,
      policyCandidateRegistryEnabled: true,
      policyShadowPromotionEnabled: false,
      policyCanaryPromotionEnabled: false
    });
    trackingService.createOrUpdateRun.mockResolvedValue({
      id: "run-42",
      runKey: "run-key-42"
    });

    const service = new ResearchLabOrchestrationService(
      queue,
      prisma,
      configService,
      trackingService,
      tuningEngineService,
      objectiveFunctionService,
      trialPruningService,
      robustnessCheckService,
      segmentScorecardService,
      candidateRegistry,
      promotionGateService,
      internalRuntimeSecurityService
    );

    (service as any).flowProducer = {
      add: jest.fn().mockResolvedValue({ id: "flow-1" })
    };

    const result = await service.enqueueResearchFlow({
      projectId: "project-1",
      experimentId: "exp-1",
      rangeStart: new Date("2026-01-01T00:00:00.000Z"),
      rangeEnd: new Date("2026-02-01T00:00:00.000Z"),
      sport: "football",
      objectiveMetric: "roi",
      datasetHashes: { feature: "hash-1" },
      seed: 42,
      searchType: TuningSearchType.RANDOM
    });

    expect(result.queued).toBe(true);
    expect(internalRuntimeSecurityService.validateQueuePayload).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: "research-lab",
        mode: "enqueue"
      })
    );
  });

  it("validates queue payloads during process", async () => {
    const service = new ResearchLabOrchestrationService(
      queue,
      prisma,
      configService,
      trackingService,
      tuningEngineService,
      objectiveFunctionService,
      trialPruningService,
      robustnessCheckService,
      segmentScorecardService,
      candidateRegistry,
      promotionGateService,
      internalRuntimeSecurityService
    );

    jest.spyOn(service as any, "processStage").mockResolvedValue(undefined);

    await (service as any).processQueuedStage("freezeDataset", {
      stage: "freezeDataset",
      runId: "run-99",
      authority: "internal",
      serviceIdentityId: "research-lab-worker",
      runKey: "run-key",
      dedupKey: "dedup",
      projectId: "project",
      experimentId: "exp",
      rangeStart: new Date("2026-01-01T00:00:00.000Z").toISOString(),
      rangeEnd: new Date("2026-02-01T00:00:00.000Z").toISOString(),
      sport: "football",
      objectiveMetric: "roi",
      secondaryMetrics: [],
      datasetHashes: { feature: "hash-1" },
      seed: 1,
      searchType: TuningSearchType.RANDOM,
      maxTrials: 10,
      actor: "system",
      strategyConfig: {},
      marketScope: [],
      horizonScope: [],
      leagueScope: [],
      notes: null,
      tags: []
    });

    expect(internalRuntimeSecurityService.validateQueuePayload).toHaveBeenCalledWith(
      expect.objectContaining({
        queueName: "research-lab",
        mode: "process",
        jobName: "freezeDataset"
      })
    );
  });

  it("rejects public-authority process payloads", async () => {
    internalRuntimeSecurityService.validateQueuePayload.mockImplementationOnce(async ({ payload }: any) => {
      if (payload?.authority === "public") {
        throw new Error("Public authority cannot trigger privileged queue jobs");
      }
      return {
        queueName: "research-lab",
        jobName: "freezeDataset",
        serviceIdentityId: "research-lab-worker",
        payload
      };
    });

    const service = new ResearchLabOrchestrationService(
      queue,
      prisma,
      configService,
      trackingService,
      tuningEngineService,
      objectiveFunctionService,
      trialPruningService,
      robustnessCheckService,
      segmentScorecardService,
      candidateRegistry,
      promotionGateService,
      internalRuntimeSecurityService
    );

    await expect(
      (service as any).processQueuedStage("freezeDataset", {
        stage: "freezeDataset",
        runId: "run-100",
        authority: "public",
        serviceIdentityId: "research-lab-worker",
        runKey: "rk",
        dedupKey: "dedup",
        projectId: "project",
        experimentId: "exp",
        rangeStart: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        rangeEnd: new Date("2026-02-01T00:00:00.000Z").toISOString(),
        sport: "football",
        objectiveMetric: "roi",
        secondaryMetrics: [],
        datasetHashes: {},
        seed: 1,
        searchType: TuningSearchType.RANDOM,
        maxTrials: 10,
        actor: "system",
        strategyConfig: {},
        marketScope: [],
        horizonScope: [],
        leagueScope: [],
        notes: null,
        tags: []
      })
    ).rejects.toThrow("Public authority cannot trigger privileged queue jobs");
  });
});
