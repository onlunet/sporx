import { BasketballRatingModelService } from "./basketball-rating-model.service";
import { BasketballFeatureSnapshot } from "./basketball-feature.types";

const baseFeatures: BasketballFeatureSnapshot = {
  matchId: "match-2",
  home: {
    teamId: "home",
    sampleSize: 12,
    pointsForAvg: 114,
    pointsAgainstAvg: 103,
    recentFormScore: 0.66,
    attackMomentum: 0.7,
    defenseFragility: 0.38,
    goalVolatility: 0.33,
    pace: 100,
    offensiveRating: 118,
    defensiveRating: 105,
    netRating: 13,
    effectiveFgPct: 0.56,
    trueShootingPct: 0.6,
    turnoverPct: 0.125,
    offensiveReboundPct: 0.3,
    defensiveReboundPct: 0.72,
    freeThrowRate: 0.25,
    threePointAttemptRate: 0.41,
    pointsInPaint: 48,
    secondChancePoints: 13,
    fastBreakPoints: 14,
    benchPoints: 32,
    assistRatio: 0.63,
    assistToTurnoverRatio: 1.84,
    stealRate: 0.08,
    blockRate: 0.052,
    foulRate: 0.19,
    playerAvailabilityScore: 0.84,
    topUsageAvailabilityScore: 0.82,
    rotationStabilityScore: 0.78,
    lineupContinuityScore: 0.77,
    restDays: 2,
    backToBack: false,
    thirdGameInFourNights: false,
    travelLoad: 0.18,
    overtimeHangover: false,
    opponentAdjustedStrength: 0.7
  },
  away: {
    teamId: "away",
    sampleSize: 12,
    pointsForAvg: 106,
    pointsAgainstAvg: 110,
    recentFormScore: 0.49,
    attackMomentum: 0.55,
    defenseFragility: 0.58,
    goalVolatility: 0.37,
    pace: 99,
    offensiveRating: 109,
    defensiveRating: 112,
    netRating: -3,
    effectiveFgPct: 0.52,
    trueShootingPct: 0.55,
    turnoverPct: 0.144,
    offensiveReboundPct: 0.27,
    defensiveReboundPct: 0.69,
    freeThrowRate: 0.21,
    threePointAttemptRate: 0.38,
    pointsInPaint: 42,
    secondChancePoints: 10,
    fastBreakPoints: 11,
    benchPoints: 27,
    assistRatio: 0.58,
    assistToTurnoverRatio: 1.49,
    stealRate: 0.069,
    blockRate: 0.043,
    foulRate: 0.22,
    playerAvailabilityScore: 0.74,
    topUsageAvailabilityScore: 0.7,
    rotationStabilityScore: 0.66,
    lineupContinuityScore: 0.65,
    restDays: 1,
    backToBack: true,
    thirdGameInFourNights: true,
    travelLoad: 0.36,
    overtimeHangover: false,
    opponentAdjustedStrength: 0.46
  },
  context: {
    playoff: false,
    mustWinPressure: 0.52,
    rivalryIntensity: 0.4,
    motivationScore: 0.51,
    scheduleFatigueScore: 0.48,
    lineupCertaintyScore: 0.77,
    leagueDataQualityScore: 0.86
  },
  market: {
    oddsDataCoverage: 0.34,
    oddsFreshnessScore: 0.82,
    oddsSourceQualityScore: 0.58
  },
  sampleQualityScore: 0.76
};

describe("BasketballRatingModelService", () => {
  it("returns stronger home win probability when home profile is superior", () => {
    const service = new BasketballRatingModelService();
    const projection = service.project(baseFeatures, { expectedPossessions: 100, paceBucket: "balanced" });

    expect(projection.homeExpectedPoints).toBeGreaterThan(projection.awayExpectedPoints);
    expect(projection.outcomeProbabilities.home).toBeGreaterThan(projection.outcomeProbabilities.away);
    expect(projection.totalLineProbabilities.length).toBeGreaterThan(0);
  });
});
