import { OddsFeatureService } from "./odds-feature.service";

describe("OddsFeatureService", () => {
  const service = new OddsFeatureService();

  it("removes bookmaker margin", () => {
    const fair = service.removeBookmakerMargin([0.55, 0.30, 0.25]);
    const sum = fair.reduce((acc, value) => acc + value, 0);

    expect(sum).toBeCloseTo(1, 5);
    expect(fair[0]).toBeLessThan(0.55);
  });

  it("computes market summary from snapshots", () => {
    const now = new Date("2026-04-13T12:00:00Z");
    const summary = service.summarizeMarketSnapshots(
      [
        {
          bookmaker: "Bet365",
          impliedProbability: 0.5,
          fairProbability: 0.48,
          capturedAt: new Date("2026-04-13T10:00:00Z")
        },
        {
          bookmaker: "Bet365",
          impliedProbability: 0.54,
          fairProbability: 0.51,
          capturedAt: new Date("2026-04-13T11:55:00Z")
        },
        {
          bookmaker: "Unibet",
          impliedProbability: 0.52,
          fairProbability: 0.5,
          capturedAt: new Date("2026-04-13T11:54:00Z")
        }
      ],
      now
    );

    expect(summary).not.toBeNull();
    expect(summary?.latestImpliedProbability).toBeGreaterThan(0.5);
    expect(summary?.coverage).toBe(2);
  });
});
