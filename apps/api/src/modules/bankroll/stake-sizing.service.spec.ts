import { StakeSizingService } from "./stake-sizing.service";

describe("StakeSizingService", () => {
  const service = new StakeSizingService();

  const baseConfig = {
    kellyFraction: 0.25,
    hardMaxFractionPerBet: 0.03,
    minStake: 1,
    maxStake: 200,
    minEdge: 0.005,
    minConfidence: 0.56,
    minPublishScore: 0.6,
    flatUnit: 10,
    riskBudgetFraction: 0.02
  };

  it("returns NO_STAKE when edge is non-positive", () => {
    const result = service.score({
      profile: "CAPPED_FRACTIONAL_KELLY",
      bankrollAvailable: 1000,
      calibratedProbability: 0.61,
      fairOdds: 1.8,
      offeredOdds: 1.9,
      edge: 0,
      confidence: 0.72,
      publishScore: 0.69,
      config: baseConfig
    });

    expect(result.status).toBe("NO_STAKE");
    expect(result.clippedStake).toBe(0);
    expect(result.reasons).toContain("NON_POSITIVE_EDGE");
  });

  it("capped fractional kelly never exceeds hard cap", () => {
    const result = service.score({
      profile: "CAPPED_FRACTIONAL_KELLY",
      bankrollAvailable: 10_000,
      calibratedProbability: 0.8,
      fairOdds: 1.25,
      offeredOdds: 2.6,
      edge: 0.1,
      confidence: 0.85,
      publishScore: 0.84,
      config: {
        ...baseConfig,
        hardMaxFractionPerBet: 0.02,
        maxStake: 10_000
      }
    });

    expect(result.recommendedFraction).toBeLessThanOrEqual(0.02);
    expect(result.recommendedStake).toBeLessThanOrEqual(200);
  });
});
