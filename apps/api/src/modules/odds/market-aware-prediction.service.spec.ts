import { MarketAwarePredictionService } from "./market-aware-prediction.service";

describe("MarketAwarePredictionService", () => {
  const service = new MarketAwarePredictionService();

  it("blends model and market probabilities", () => {
    const blended = service.blend(
      { home: 0.6, draw: 0.25, away: 0.15 },
      { home: 0.52, draw: 0.27, away: 0.21 },
      0.04
    );

    const sum = Object.values(blended).reduce((acc, value) => acc + value, 0);
    expect(sum).toBeCloseTo(1, 4);
    expect(blended.home).toBeGreaterThan(0.52);
    expect(blended.home).toBeLessThan(0.6);
  });

  it("falls back to model probabilities when market is missing", () => {
    const blended = service.blend({ yes: 0.57, no: 0.43 }, null, 0);
    expect(blended.yes).toBeCloseTo(0.57, 4);
    expect(blended.no).toBeCloseTo(0.43, 4);
  });
});
