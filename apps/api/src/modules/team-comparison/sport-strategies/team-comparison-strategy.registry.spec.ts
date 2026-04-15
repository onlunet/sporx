import { BasketballComparisonStrategy } from "./basketball-comparison.strategy";
import { FootballComparisonStrategy } from "./football-comparison.strategy";
import { TeamComparisonStrategyRegistry } from "./team-comparison-strategy.registry";

describe("TeamComparisonStrategyRegistry", () => {
  const football = new FootballComparisonStrategy({} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  const basketball = new BasketballComparisonStrategy(football);
  const registry = new TeamComparisonStrategyRegistry(football, basketball);

  it("resolves basketball aliases", () => {
    expect(registry.forSport("basketball").sport).toBe("basketball");
    expect(registry.forSport("nba").sport).toBe("basketball");
    expect(registry.forSport("basket").sport).toBe("basketball");
  });

  it("defaults to football for unknown sport", () => {
    expect(registry.forSport(undefined).sport).toBe("football");
    expect(registry.forSport("volleyball").sport).toBe("football");
  });
});
