import { ComparisonConfidenceService } from "./comparison-confidence.service";

describe("ComparisonConfidenceService", () => {
  const service = new ComparisonConfidenceService();

  it("returns bounded confidence", () => {
    const score = service.compute([
      { key: "overall", homeValue: 0.8, awayValue: 0.2, advantage: "home" },
      { key: "defense", homeValue: 0.7, awayValue: 0.4, advantage: "home" }
    ]);

    expect(score).toBeGreaterThanOrEqual(0.2);
    expect(score).toBeLessThanOrEqual(0.95);
  });

  it("increases score when sample and directional consistency are stronger", () => {
    const lowSignal = service.compute(
      [
        { key: "overall", homeValue: 0.52, awayValue: 0.49, advantage: "home" },
        { key: "offense", homeValue: 0.6, awayValue: 0.58, advantage: "home" }
      ],
      { homeSampleSize: 2, awaySampleSize: 2, fallbackUsed: true }
    );

    const strongSignal = service.compute(
      [
        { key: "overall", homeValue: 0.82, awayValue: 0.46, advantage: "home" },
        { key: "offense", homeValue: 1.4, awayValue: 0.9, advantage: "home" },
        { key: "defense", homeValue: 1.2, awayValue: 0.7, advantage: "home" }
      ],
      { homeSampleSize: 12, awaySampleSize: 11, fallbackUsed: false }
    );

    expect(strongSignal).toBeGreaterThan(lowSignal);
  });
});
