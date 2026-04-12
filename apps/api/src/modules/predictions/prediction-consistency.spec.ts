import { AdvancedPredictionEngineService } from "./advanced-prediction-engine.service";
import { AdvancedEloService } from "./advanced-elo.service";
import { DixonColesService } from "./dixon-coles.service";
import { DynamicLambdaService } from "./dynamic-lambda.service";
import { PredictionEngineService } from "./prediction-engine.service";
import { TimeDecayService } from "./time-decay.service";

describe("Prediction consistency", () => {
  const baseEngine = new PredictionEngineService();
  const advancedEngine = new AdvancedPredictionEngineService(
    baseEngine,
    new TimeDecayService(),
    new AdvancedEloService(),
    new DynamicLambdaService(),
    new DixonColesService()
  );

  it("keeps probabilities bounded and coherent between engines", () => {
    const base = baseEngine.computeEloProbabilities({ homeElo: 1620, awayElo: 1565 });
    const advanced = advancedEngine.compute({
      homeElo: 1620,
      awayElo: 1565,
      homeAttack: 1.09,
      awayAttack: 0.97,
      homeDefense: 1.03,
      awayDefense: 0.94,
      form5Home: 0.64,
      form5Away: 0.55,
      scheduleFatigueScore: 0.28,
      lineupCertaintyScore: 0.74,
      contextPressureScore: 0.57,
      leagueGoalEnvironment: 1.01,
      homeAwaySplitStrength: 0.66,
      opponentAdjustedStrength: 0.62,
      baselineAdjustedLambdaHome: 1.52,
      baselineAdjustedLambdaAway: 1.1,
      lowScoreBias: 0.05,
      kickoffAt: new Date(Date.now() + 60 * 60 * 1000),
      now: new Date()
    });

    const advancedOutcome = advanced.calibratedProbabilities;
    expect(advancedOutcome.home).toBeGreaterThanOrEqual(0);
    expect(advancedOutcome.draw).toBeGreaterThanOrEqual(0);
    expect(advancedOutcome.away).toBeGreaterThanOrEqual(0);
    expect(advancedOutcome.home).toBeLessThanOrEqual(1);
    expect(advancedOutcome.draw).toBeLessThanOrEqual(1);
    expect(advancedOutcome.away).toBeLessThanOrEqual(1);
    expect(Math.abs(advancedOutcome.home - base.home)).toBeLessThan(0.25);
  });
});

