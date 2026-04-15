export type BasketballRiskFlag = {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
};

export type BasketballTeamFeatureSnapshot = {
  teamId: string;
  sampleSize: number;
  pointsForAvg: number;
  pointsAgainstAvg: number;
  recentFormScore: number;
  attackMomentum: number;
  defenseFragility: number;
  goalVolatility: number;
  pace: number;
  offensiveRating: number;
  defensiveRating: number;
  netRating: number;
  effectiveFgPct: number;
  trueShootingPct: number;
  turnoverPct: number;
  offensiveReboundPct: number;
  defensiveReboundPct: number;
  freeThrowRate: number;
  threePointAttemptRate: number;
  pointsInPaint: number;
  secondChancePoints: number;
  fastBreakPoints: number;
  benchPoints: number;
  assistRatio: number;
  assistToTurnoverRatio: number;
  stealRate: number;
  blockRate: number;
  foulRate: number;
  playerAvailabilityScore: number;
  topUsageAvailabilityScore: number;
  rotationStabilityScore: number;
  lineupContinuityScore: number;
  restDays: number;
  backToBack: boolean;
  thirdGameInFourNights: boolean;
  travelLoad: number;
  overtimeHangover: boolean;
  opponentAdjustedStrength: number;
};

export type BasketballFeatureSnapshot = {
  matchId: string;
  home: BasketballTeamFeatureSnapshot;
  away: BasketballTeamFeatureSnapshot;
  context: {
    playoff: boolean;
    mustWinPressure: number;
    rivalryIntensity: number;
    motivationScore: number;
    scheduleFatigueScore: number;
    lineupCertaintyScore: number;
    leagueDataQualityScore: number;
  };
  market: {
    oddsDataCoverage: number;
    oddsFreshnessScore: number;
    oddsSourceQualityScore: number;
  };
  sampleQualityScore: number;
};

export type BasketballPossessionProjection = {
  expectedPossessions: number;
  paceBucket: "slow" | "balanced" | "fast";
};

export type BasketballCoreProjection = {
  homeExpectedPoints: number;
  awayExpectedPoints: number;
  expectedTotal: number;
  expectedSpreadHome: number;
  projectedFirstHalfTotal: number;
  projectedSecondHalfTotal: number;
  outcomeProbabilities: {
    home: number;
    draw: number;
    away: number;
  };
  firstHalfProbabilities: {
    home: number;
    draw: number;
    away: number;
  };
  totalLineProbabilities: Array<{
    line: number;
    over: number;
    under: number;
  }>;
};

export type BasketballMarketSnapshot = {
  hasMarketData: boolean;
  moneyline: {
    home: number | null;
    draw: number | null;
    away: number | null;
  };
  totals: Array<{
    line: number;
    over: number;
    under: number;
  }>;
  freshnessMinutes: number | null;
  coverageScore: number;
};

export type BasketballBlendedProjection = {
  outcomeProbabilities: {
    home: number;
    draw: number;
    away: number;
  };
  firstHalfProbabilities: {
    home: number;
    draw: number;
    away: number;
  };
  totalLineProbabilities: Array<{
    line: number;
    over: number;
    under: number;
  }>;
  marketAgreementLevel: "aligned" | "mixed" | "divergent";
  riskFlags: BasketballRiskFlag[];
};
