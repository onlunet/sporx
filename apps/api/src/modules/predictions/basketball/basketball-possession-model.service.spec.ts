import { BasketballPossessionModelService } from "./basketball-possession-model.service";
import { BasketballFeatureSnapshot } from "./basketball-feature.types";

function createFeatureSnapshot(paceHome: number, paceAway: number): BasketballFeatureSnapshot {
  return {
    matchId: "match-1",
    home: {
      teamId: "home",
      sampleSize: 10,
      pointsForAvg: 111,
      pointsAgainstAvg: 104,
      recentFormScore: 0.62,
      attackMomentum: 0.66,
      defenseFragility: 0.44,
      goalVolatility: 0.36,
      pace: paceHome,
      offensiveRating: 114,
      defensiveRating: 107,
      netRating: 7,
      effectiveFgPct: 0.54,
      trueShootingPct: 0.58,
      turnoverPct: 0.13,
      offensiveReboundPct: 0.29,
      defensiveReboundPct: 0.71,
      freeThrowRate: 0.23,
      threePointAttemptRate: 0.4,
      pointsInPaint: 46,
      secondChancePoints: 11,
      fastBreakPoints: 13,
      benchPoints: 31,
      assistRatio: 0.62,
      assistToTurnoverRatio: 1.7,
      stealRate: 0.078,
      blockRate: 0.051,
      foulRate: 0.2,
      playerAvailabilityScore: 0.82,
      topUsageAvailabilityScore: 0.8,
      rotationStabilityScore: 0.75,
      lineupContinuityScore: 0.74,
      restDays: 2,
      backToBack: false,
      thirdGameInFourNights: false,
      travelLoad: 0.2,
      overtimeHangover: false,
      opponentAdjustedStrength: 0.65
    },
    away: {
      teamId: "away",
      sampleSize: 10,
      pointsForAvg: 108,
      pointsAgainstAvg: 106,
      recentFormScore: 0.55,
      attackMomentum: 0.58,
      defenseFragility: 0.48,
      goalVolatility: 0.34,
      pace: paceAway,
      offensiveRating: 111,
      defensiveRating: 109,
      netRating: 2,
      effectiveFgPct: 0.53,
      trueShootingPct: 0.57,
      turnoverPct: 0.14,
      offensiveReboundPct: 0.28,
      defensiveReboundPct: 0.7,
      freeThrowRate: 0.22,
      threePointAttemptRate: 0.39,
      pointsInPaint: 43,
      secondChancePoints: 10,
      fastBreakPoints: 12,
      benchPoints: 29,
      assistRatio: 0.6,
      assistToTurnoverRatio: 1.61,
      stealRate: 0.072,
      blockRate: 0.047,
      foulRate: 0.21,
      playerAvailabilityScore: 0.79,
      topUsageAvailabilityScore: 0.76,
      rotationStabilityScore: 0.7,
      lineupContinuityScore: 0.7,
      restDays: 1,
      backToBack: true,
      thirdGameInFourNights: false,
      travelLoad: 0.36,
      overtimeHangover: false,
      opponentAdjustedStrength: 0.58
    },
    context: {
      playoff: false,
      mustWinPressure: 0.5,
      rivalryIntensity: 0.45,
      motivationScore: 0.52,
      scheduleFatigueScore: 0.34,
      lineupCertaintyScore: 0.8,
      leagueDataQualityScore: 0.82
    },
    market: {
      oddsDataCoverage: 0.4,
      oddsFreshnessScore: 0.7,
      oddsSourceQualityScore: 0.55
    },
    sampleQualityScore: 0.71
  };
}

describe("BasketballPossessionModelService", () => {
  it("projects faster pace when both teams have high pace", () => {
    const service = new BasketballPossessionModelService();
    const fast = service.project(createFeatureSnapshot(103, 102));
    const slow = service.project(createFeatureSnapshot(92, 91));

    expect(fast.expectedPossessions).toBeGreaterThan(slow.expectedPossessions);
    expect(fast.paceBucket).toBe("fast");
    expect(slow.paceBucket).toBe("slow");
  });
});
