import { PredictionEngineService } from "./prediction-engine.service";

describe("PredictionEngineService", () => {
  const service = new PredictionEngineService();

  it("should produce probability triplet summing near 1", () => {
    const probs = service.computeEloProbabilities({ homeElo: 1700, awayElo: 1600 });
    const sum = probs.home + probs.draw + probs.away;
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
  });

  it("should generate risk flags for low confidence", () => {
    const flags = service.riskFlags(0.45);
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0].code).toBe("LOW_CONFIDENCE");
  });

  it("should reduce draw probability on large elo gap", () => {
    const balanced = service.computeEloProbabilities({ homeElo: 1500, awayElo: 1500 });
    const imbalanced = service.computeEloProbabilities({ homeElo: 1900, awayElo: 1300 });
    expect(imbalanced.draw).toBeLessThan(balanced.draw);
  });

  it("calibration should adjust distribution", () => {
    const probs = { home: 0.55, draw: 0.25, away: 0.2 };
    const calibrated = service.calibrate(probs, 1.1);
    expect(calibrated.home).not.toBe(probs.home);
  });
});
