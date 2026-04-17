import { AdminResearchLabController } from "./admin-research-lab.controller";

describe("AdminResearchLabController", () => {
  const prisma = {} as any;
  const configService = {
    setSettings: jest.fn(),
    getSettings: jest.fn().mockResolvedValue({
      researchLabEnabled: true,
      autoTuningEnabled: false,
      trialPruningEnabled: true,
      policyCandidateRegistryEnabled: true,
      policyShadowPromotionEnabled: false,
      policyCanaryPromotionEnabled: false
    })
  } as any;
  const trackingService = {
    compareRuns: jest.fn()
  } as any;
  const orchestrationService = {
    queueName: jest.fn().mockReturnValue("research-lab"),
    stages: jest.fn().mockReturnValue(["freezeDataset", "generateConfigSet"])
  } as any;
  const candidateRegistry = {} as any;
  const promotionGateService = {} as any;

  it("returns consistent run comparison metadata", async () => {
    trackingService.compareRuns.mockResolvedValue([
      {
        runId: "run-1",
        projectId: "project-1",
        experimentId: "exp-1",
        status: "succeeded",
        objectiveMetric: "roi",
        datasetHashes: { feature: "abc" },
        configVersionId: "cfg-1",
        searchSpaceId: "space-1",
        seed: 42,
        metrics: { roi: 0.12 }
      }
    ]);

    const controller = new AdminResearchLabController(
      prisma,
      configService,
      trackingService,
      orchestrationService,
      candidateRegistry,
      promotionGateService
    );
    const output = await controller.compareRuns("run-1");
    expect(output).toHaveLength(1);
    expect(output[0]).toMatchObject({
      runId: "run-1",
      projectId: "project-1",
      experimentId: "exp-1",
      objectiveMetric: "roi"
    });
  });
});
