import { AdvancedPredictionEngineService } from "./advanced-prediction-engine.service";
import { AdvancedEloService } from "./advanced-elo.service";
import { DixonColesService } from "./dixon-coles.service";
import { DynamicLambdaService } from "./dynamic-lambda.service";
import { PredictionEngineService } from "./prediction-engine.service";
import { TimeDecayService } from "./time-decay.service";

describe("AdvancedPredictionEngineService", () => {
  const service = new AdvancedPredictionEngineService(
    new PredictionEngineService(),
    new TimeDecayService(),
    new AdvancedEloService(),
    new DynamicLambdaService(),
    new DixonColesService()
  );

  it("produces valid probabilities and score matrix", () => {
    const result = service.compute({
      homeElo: 1650,
      awayElo: 1585,
      homeAttack: 1.08,
      awayAttack: 0.97,
      homeDefense: 1.02,
      awayDefense: 0.95,
      form5Home: 0.7,
      form5Away: 0.52,
      scheduleFatigueScore: 0.3,
      lineupCertaintyScore: 0.72,
      contextPressureScore: 0.58,
      leagueGoalEnvironment: 1.03,
      homeAwaySplitStrength: 0.68,
      opponentAdjustedStrength: 0.63,
      baselineAdjustedLambdaHome: 1.6,
      baselineAdjustedLambdaAway: 1.15,
      lowScoreBias: 0.05,
      kickoffAt: new Date(Date.now() + 2 * 60 * 60 * 1000),
      now: new Date()
    });

    const sum =
      result.calibratedProbabilities.home + result.calibratedProbabilities.draw + result.calibratedProbabilities.away;

    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
    expect(result.scoreMatrixTop.length).toBeGreaterThan(0);
    expect(result.adjustedLambdaHome).toBeGreaterThan(0.2);
    expect(result.adjustedLambdaAway).toBeGreaterThan(0.2);
  });
});

