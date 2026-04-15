import { BasketballPredictionStrategy } from "./basketball-prediction.strategy";
import { FootballPredictionStrategy } from "./football-prediction.strategy";
import { PredictionSportStrategyRegistry } from "./prediction-sport-strategy.registry";

describe("PredictionSportStrategyRegistry", () => {
  const football = new FootballPredictionStrategy();
  const basketball = new BasketballPredictionStrategy();
  const registry = new PredictionSportStrategyRegistry(football, basketball);

  it("resolves basketball aliases", () => {
    expect(registry.forSport("basketball").sport).toBe("basketball");
    expect(registry.forSport("nba").sport).toBe("basketball");
    expect(registry.forSport("basket").sport).toBe("basketball");
  });

  it("defaults to football when sport is missing or unknown", () => {
    expect(registry.forSport(undefined).sport).toBe("football");
    expect(registry.forSport("unknown").sport).toBe("football");
  });
});

