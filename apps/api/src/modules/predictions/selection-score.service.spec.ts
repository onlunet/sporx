import { SelectionScoreService } from "./selection-score.service";

describe("SelectionScoreService", () => {
  it("produces deterministic score for identical inputs", () => {
    const service = new SelectionScoreService();
    const profile = {
      minConfidence: 0.56,
      minPublishScore: 0.58,
      minEdge: 0,
      maxVolatility: 0.34,
      maxProviderDisagreement: 0.25,
      minLineupCoverage: 0.45,
      minEventCoverage: 0.3,
      maxMissingStatsRatio: 0.55,
      minFreshnessScore: 0.4,
      maxPicksPerMatch: 2,
      requireOdds: true,
      valueOnly: false,
      requireLineupHorizons: [],
      allowedMarkets: [],
      allowedHorizons: [],
      allowedLeagueIds: []
    };

    const input = {
      calibratedProbability: 0.64,
      confidence: 0.61,
      edge: 0.028,
      freshnessScore: 0.73,
      volatilityScore: 0.18,
      providerDisagreement: 0.09,
      coverageFlags: {
        has_odds: true,
        has_lineup: true,
        has_event_data: true,
        missing_stats_ratio: 0.22
      },
      profile
    };

    const first = service.score(input);
    const second = service.score(input);

    expect(first.score).toBe(second.score);
    expect(first.breakdown).toEqual(second.breakdown);
  });
});
