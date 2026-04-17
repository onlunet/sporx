import { TrialPruningService } from "./trial-pruning.service";

describe("TrialPruningService", () => {
  it("prunes and returns reason for high drawdown after minimum sample", () => {
    const service = new TrialPruningService();
    const decision = service.decide({
      drawdown: 0.42,
      riskOfRuin: 0.08,
      roi: 0.05,
      logLoss: 0.6,
      sampleSize: 120,
      config: {
        maxDrawdown: 0.32,
        maxRiskOfRuin: 0.2,
        minRoiFloor: -0.03,
        maxLogLoss: 0.9,
        minSampleForDecision: 60
      }
    });

    expect(decision.pruned).toBe(true);
    expect(decision.reason).toBe("drawdown_breach");
  });

  it("persists prune reason", async () => {
    const service = new TrialPruningService();
    const tx = {
      tuningTrial: {
        update: jest.fn().mockResolvedValue({ id: "trial-1", pruned: true, pruneReason: "risk_of_ruin_breach" })
      }
    } as any;
    const result = await service.persistDecision(tx, {
      trialId: "trial-1",
      decision: { pruned: true, reason: "risk_of_ruin_breach" },
      metrics: { roi: -0.01 }
    });

    expect(tx.tuningTrial.update).toHaveBeenCalledTimes(1);
    expect(result.pruned).toBe(true);
    expect(result.pruneReason).toBe("risk_of_ruin_breach");
  });
});
