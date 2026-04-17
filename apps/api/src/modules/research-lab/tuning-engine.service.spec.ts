import { TuningSearchType } from "@prisma/client";
import { TuningEngineService } from "./tuning-engine.service";

describe("TuningEngineService", () => {
  it("reproduces same random trial plan with same seed/config", () => {
    const service = new TuningEngineService();
    const input = {
      experimentId: "exp-1",
      runId: "run-1",
      baseSeed: 42,
      searchSpace: {
        type: TuningSearchType.RANDOM,
        maxTrials: 5,
        random: {
          min_confidence: { min: 0.5, max: 0.7, step: 0.01 },
          min_publish_score: { min: 0.5, max: 0.75, step: 0.01 }
        }
      }
    };

    const first = service.buildTrialPlan(input);
    const second = service.buildTrialPlan(input);
    expect(first).toEqual(second);
  });

  it("supports deterministic grid generation", () => {
    const service = new TuningEngineService();
    const plan = service.buildTrialPlan({
      experimentId: "exp-1",
      runId: "run-1",
      baseSeed: 7,
      searchSpace: {
        type: TuningSearchType.GRID,
        maxTrials: 10,
        grid: {
          min_confidence: [0.55, 0.6],
          min_publish_score: [0.58, 0.62]
        }
      }
    });

    expect(plan).toHaveLength(4);
    expect(plan[0].trialNumber).toBe(1);
    expect(plan[3].trialNumber).toBe(4);
  });
});
