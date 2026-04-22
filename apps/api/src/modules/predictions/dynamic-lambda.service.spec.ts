import { DynamicLambdaService } from "./dynamic-lambda.service";

describe("DynamicLambdaService", () => {
  const service = new DynamicLambdaService();

  const baseInput = {
    homeAttack: 1.1,
    awayAttack: 0.98,
    homeDefense: 1.02,
    awayDefense: 0.95,
    eloHome: 1620,
    eloAway: 1560,
    homeFormScore: 0.64,
    awayFormScore: 0.52,
    scheduleFatigueScore: 0.25,
    lineupCertaintyScore: 0.72,
    contextPressureScore: 0.55,
    leagueGoalEnvironment: 1.02,
    homeAdvantageMultiplier: 1.1,
    awayPenaltyMultiplier: 0.92
  };

  it("returns positive lambdas in expected range", () => {
    const result = service.compute(baseInput);
    expect(result.adjustedLambdaHome).toBeGreaterThan(0.2);
    expect(result.adjustedLambdaAway).toBeGreaterThan(0.2);
    expect(result.adjustedLambdaHome).toBeLessThan(4);
    expect(result.adjustedLambdaAway).toBeLessThan(4);
  });

  it("does not compress balanced football matches into a low scoring baseline", () => {
    const result = service.compute({
      ...baseInput,
      homeAttack: 0.9,
      awayAttack: 0.9,
      homeDefense: 1.16,
      awayDefense: 1.16,
      eloHome: 1500,
      eloAway: 1500,
      homeFormScore: 0.55,
      awayFormScore: 0.55,
      scheduleFatigueScore: 0.1,
      lineupCertaintyScore: 0.9,
      contextPressureScore: 0.5,
      leagueGoalEnvironment: 1,
      homeAdvantageMultiplier: 1.01,
      awayPenaltyMultiplier: 0.995
    });

    expect(result.adjustedLambdaHome + result.adjustedLambdaAway).toBeGreaterThan(2.45);
    expect(result.adjustedLambdaHome).toBeGreaterThan(result.adjustedLambdaAway);
  });

  it("reduces output with worse lineup certainty and fatigue", () => {
    const stable = service.compute({
      ...baseInput,
      scheduleFatigueScore: 0.1,
      lineupCertaintyScore: 0.9
    });
    const risky = service.compute({
      ...baseInput,
      scheduleFatigueScore: 0.8,
      lineupCertaintyScore: 0.35
    });

    expect(stable.adjustedLambdaHome).toBeGreaterThan(risky.adjustedLambdaHome);
    expect(risky.volatilityScore).toBeGreaterThan(stable.volatilityScore);
  });
});
