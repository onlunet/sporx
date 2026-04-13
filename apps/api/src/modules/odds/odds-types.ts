export type NormalizedMarketType =
  | "matchResult"
  | "firstHalfResult"
  | "bothTeamsToScore"
  | "totalGoalsOverUnder"
  | "correctScore"
  | "halfTimeFullTime";

export type MovementDirection = "up" | "down" | "flat";

export type NormalizedOddsEntry = {
  bookmaker: string;
  marketType: NormalizedMarketType;
  selectionKey: string;
  line: number | null;
  oddsValue: number;
  capturedAt: Date;
};

export type MarketOddsSummary = {
  marketImpliedProbability: number;
  fairMarketProbability: number | null;
  openingImpliedProbability: number | null;
  latestImpliedProbability: number;
  movementDirection: MovementDirection;
  movementSpeed: number;
  volatilityScore: number;
  consensusScore: number;
  bookmakerDisagreementScore: number;
  coverage: number;
  freshnessScore: number;
};

export type MarketAnalysisResult = {
  modelProbability: number;
  marketImpliedProbability: number;
  fairMarketProbability: number | null;
  probabilityGap: number;
  movementDirection: MovementDirection;
  volatilityScore: number;
  consensusScore: number;
  contradictionScore: number;
};
