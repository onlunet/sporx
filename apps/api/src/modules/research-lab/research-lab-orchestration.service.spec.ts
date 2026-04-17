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
      promotionGateService
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
      promotionGateService
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
});
