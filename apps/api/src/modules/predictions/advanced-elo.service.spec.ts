import { AdvancedEloService } from "./advanced-elo.service";

describe("AdvancedEloService", () => {
  const service = new AdvancedEloService();

  it("applies home advantage and returns an elo gap", () => {
    const result = service.compute({
      homeElo: 1600,
      awayElo: 1600,
      homeFormScore: 0.6,
      awayFormScore: 0.6,
      homeAwaySplitStrength: 0.5,
      opponentAdjustedStrength: 0.5,
      scheduleFatigueScore: 0.3,
      volatilityScore: 0.4
    });

    expect(result.eloHome).toBeGreaterThan(result.eloAway);
    expect(result.dynamicK).toBeGreaterThan(20);
  });

  it("boosts home elo when form and split are stronger", () => {
    const low = service.compute({
      homeElo: 1580,
      awayElo: 1600,
      homeFormScore: 0.4,
      awayFormScore: 0.7,
      homeAwaySplitStrength: 0.45,
      opponentAdjustedStrength: 0.45,
      scheduleFatigueScore: 0.2,
      volatilityScore: 0.4
    });
    const high = service.compute({
      homeElo: 1580,
      awayElo: 1600,
      homeFormScore: 0.8,
      awayFormScore: 0.4,
      homeAwaySplitStrength: 0.75,
      opponentAdjustedStrength: 0.7,
      scheduleFatigueScore: 0.2,
      volatilityScore: 0.4
    });

    expect(high.eloHome).toBeGreaterThan(low.eloHome);
  });
});

