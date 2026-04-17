import { AbstainPolicyService } from "./abstain-policy.service";
import { StrategyProfileConfig } from "./publish-selection.types";

const balancedProfile: StrategyProfileConfig = {
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
  requireLineupHorizons: ["LINEUP"],
  allowedMarkets: [],
  allowedHorizons: [],
  allowedLeagueIds: []
};

describe("AbstainPolicyService", () => {
  const service = new AbstainPolicyService();

  const baseCandidate = {
    id: "candidate-1",
    matchId: "match-1",
    market: "match_outcome",
    line: null,
    lineKey: "na",
    horizon: "PRE6",
    selection: "home",
    confidence: 0.64,
    calibratedProbability: 0.63,
    publishScore: 0.62,
    edge: 0.02,
    freshnessScore: 0.7,
    volatilityScore: 0.12,
    providerDisagreement: 0.08,
    lineupCoverage: 0.7,
    eventCoverage: 0.6,
    strategyProfile: "BALANCED" as const,
    coverageFlags: {
      has_odds: true,
      has_lineup: true,
      has_event_data: true,
      missing_stats_ratio: 0.2
    },
    leagueId: "league-1"
  };

  it("abstains low-confidence candidate", () => {
    const reasons = service.evaluate({
      candidate: {
        ...baseCandidate,
        confidence: 0.44
      },
      selectionScore: 0.63,
      profile: balancedProfile
    });

    expect(reasons.some((item) => item.code === "LOW_CONFIDENCE")).toBe(true);
  });

  it("abstains stale candidate", () => {
    const reasons = service.evaluate({
      candidate: {
        ...baseCandidate,
        freshnessScore: 0.22
      },
      selectionScore: 0.64,
      profile: balancedProfile
    });

    expect(reasons.some((item) => item.code === "STALE_DATA")).toBe(true);
  });

  it("abstains missing-lineup candidate when profile requires lineup", () => {
    const reasons = service.evaluate({
      candidate: {
        ...baseCandidate,
        horizon: "LINEUP",
        lineupCoverage: 0.1,
        coverageFlags: {
          ...baseCandidate.coverageFlags,
          has_lineup: false
        }
      },
      selectionScore: 0.66,
      profile: balancedProfile
    });

    expect(reasons.some((item) => item.code === "MISSING_LINEUP_REQUIRED")).toBe(true);
  });

  it("aggressive profile publishes more than conservative for same candidate set", () => {
    const candidates = [
      { ...baseCandidate, confidence: 0.58, volatilityScore: 0.24, providerDisagreement: 0.18 },
      { ...baseCandidate, confidence: 0.53, volatilityScore: 0.31, providerDisagreement: 0.22 },
      { ...baseCandidate, confidence: 0.5, volatilityScore: 0.36, providerDisagreement: 0.28 }
    ];

    const conservative: StrategyProfileConfig = {
      ...balancedProfile,
      minConfidence: 0.62,
      minPublishScore: 0.66,
      maxVolatility: 0.24,
      maxProviderDisagreement: 0.16,
      minFreshnessScore: 0.52,
      valueOnly: true,
      minEdge: 0.01
    };

    const aggressive: StrategyProfileConfig = {
      ...balancedProfile,
      minConfidence: 0.5,
      minPublishScore: 0.5,
      maxVolatility: 0.45,
      maxProviderDisagreement: 0.35,
      minFreshnessScore: 0.3,
      valueOnly: false,
      minEdge: -0.005
    };

    const conservativePublished = candidates.filter((candidate) =>
      service.evaluate({ candidate, selectionScore: 0.6, profile: conservative }).length === 0
    ).length;

    const aggressivePublished = candidates.filter((candidate) =>
      service.evaluate({ candidate, selectionScore: 0.6, profile: aggressive }).length === 0
    ).length;

    expect(aggressivePublished).toBeGreaterThan(conservativePublished);
  });
});
