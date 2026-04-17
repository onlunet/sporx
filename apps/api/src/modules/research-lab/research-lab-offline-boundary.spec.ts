import { TuningSearchType } from "@prisma/client";
import { ResearchLabOrchestrationService } from "./research-lab-orchestration.service";

describe("Research lab offline boundary", () => {
  it("stage execution does not mutate live alias/public publish tables", async () => {
    const prisma = {
      researchRun: {
        update: jest.fn().mockResolvedValue({ id: "run-1" })
      },
      modelAlias: {
        update: jest.fn()
      },
      publishedPrediction: {
        update: jest.fn()
      }
    } as any;

    const service = new ResearchLabOrchestrationService(
      {} as any,
      prisma,
      { getSettings: jest.fn().mockResolvedValue({}) } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );

    await (service as any).processStage("freezeDataset", {
      stage: "freezeDataset",
      runId: "run-1",
      runKey: "key-1",
      dedupKey: "dedup-1",
      projectId: "project-1",
      experimentId: "exp-1",
      rangeStart: "2026-01-01T00:00:00.000Z",
      rangeEnd: "2026-02-01T00:00:00.000Z",
      sport: "football",
      objectiveMetric: "roi",
      secondaryMetrics: ["yield"],
      datasetHashes: { feature: "hash" },
      seed: 42,
      searchType: TuningSearchType.RANDOM,
      maxTrials: 20,
      actor: "test",
      strategyConfig: {},
      marketScope: [],
      horizonScope: [],
      leagueScope: [],
      notes: null,
      tags: []
    });

    expect(prisma.researchRun.update).toHaveBeenCalledTimes(1);
    expect(prisma.modelAlias.update).not.toHaveBeenCalled();
    expect(prisma.publishedPrediction.update).not.toHaveBeenCalled();
  });
});
