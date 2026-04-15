import { BasketballComparisonStrategy } from "./basketball-comparison.strategy";

describe("BasketballComparisonStrategy", () => {
  it("produces basketball-specific axis output without football fallback", async () => {
    const aggregate = {
      aggregate: jest
        .fn()
        .mockResolvedValueOnce({
          shotQualityCreation: 0.62,
          halfCourtOffense: 0.58,
          transitionOffense: 0.55,
          rimPressure: 0.6,
          perimeterShotProfile: 0.53,
          turnoverControl: 0.57,
          offensiveRebounding: 0.52,
          defensiveRebounding: 0.54,
          rimDefense: 0.56,
          perimeterDefense: 0.51,
          foulDiscipline: 0.49,
          benchImpact: 0.55,
          starPowerReliability: 0.63,
          paceControl: 0.52,
          clutchStability: 0.58,
          scheduleFreshness: 0.61,
          sampleSize: 12,
          scoredSampleSize: 12,
          fallbackUsed: false
        })
        .mockResolvedValueOnce({
          shotQualityCreation: 0.48,
          halfCourtOffense: 0.5,
          transitionOffense: 0.45,
          rimPressure: 0.47,
          perimeterShotProfile: 0.46,
          turnoverControl: 0.44,
          offensiveRebounding: 0.46,
          defensiveRebounding: 0.49,
          rimDefense: 0.45,
          perimeterDefense: 0.47,
          foulDiscipline: 0.52,
          benchImpact: 0.48,
          starPowerReliability: 0.5,
          paceControl: 0.5,
          clutchStability: 0.47,
          scheduleFreshness: 0.45,
          sampleSize: 12,
          scoredSampleSize: 12,
          fallbackUsed: false
        })
    };
    const strength = { compute: jest.fn((value) => ({ ...value, overall: 0.56 })) };
    const comparison = {
      compare: jest.fn(() => [
        { key: "shotQualityCreation", homeValue: 0.62, awayValue: 0.48, advantage: "home" },
        { key: "overall", homeValue: 0.56, awayValue: 0.44, advantage: "home" }
      ])
    };
    const confidence = { compute: jest.fn(() => 0.71) };
    const scenario = { generate: jest.fn(() => ["Ev sahibi tempoyu yukseltebilir."]) };
    const explanation = { summarize: jest.fn(() => "Basketbol ozeti.") };

    const strategy = new BasketballComparisonStrategy(
      aggregate as any,
      strength as any,
      comparison as any,
      confidence as any,
      scenario as any,
      explanation as any
    );

    const result = await strategy.compare({
      homeResolved: {
        canonicalId: "home-1",
        canonicalTeam: { name: "Home Team" } as any,
        equivalentIds: ["home-1"]
      },
      awayResolved: {
        canonicalId: "away-1",
        canonicalTeam: { name: "Away Team" } as any,
        equivalentIds: ["away-1"]
      }
    });

    expect(result.axes[0]?.key).toBe("shotQualityCreation");
    expect(result.outcomeProbabilities.draw).toBe(0.004);
    expect(result.summary).toBe("Basketbol ozeti.");
    expect(aggregate.aggregate).toHaveBeenCalledTimes(2);
  });
});
