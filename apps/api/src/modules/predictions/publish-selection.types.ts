export type StrategyProfileKey = "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";

export type SelectionEngineSettings = {
  enabled: boolean;
  shadowMode: boolean;
  defaultProfile: StrategyProfileKey;
  emergencyRollback: boolean;
};

export type StrategyProfileConfig = {
  minConfidence: number;
  minPublishScore: number;
  minEdge: number;
  maxVolatility: number;
  maxProviderDisagreement: number;
  minLineupCoverage: number;
  minEventCoverage: number;
  maxMissingStatsRatio: number;
  minFreshnessScore: number;
  maxPicksPerMatch: number;
  requireOdds: boolean;
  valueOnly: boolean;
  requireLineupHorizons: string[];
  allowedMarkets: string[];
  allowedHorizons: string[];
  allowedLeagueIds: string[];
};

export type SelectionAbstainReasonCode =
  | "LOW_CONFIDENCE"
  | "LOW_PUBLISH_SCORE"
  | "STALE_DATA"
  | "MISSING_ODDS"
  | "MISSING_LINEUP_REQUIRED"
  | "LOW_EVENT_COVERAGE"
  | "HIGH_VOLATILITY"
  | "HIGH_PROVIDER_DISAGREEMENT"
  | "UNSUPPORTED_LEAGUE"
  | "UNSUPPORTED_MARKET"
  | "LOW_HISTORICAL_SUPPORT"
  | "DUPLICATE_CANDIDATE"
  | "CONFLICTING_CANDIDATE"
  | "POLICY_BLOCKED"
  | "MANUAL_BLOCK";

export type SelectionAbstainReason = {
  code: SelectionAbstainReasonCode;
  message: string;
  severity: "low" | "medium" | "high";
  details?: Record<string, unknown>;
};

export type CandidateCoverageFlags = {
  has_odds?: boolean;
  has_lineup?: boolean;
  has_event_data?: boolean;
  missing_stats_ratio?: number | null;
  [key: string]: unknown;
};

export type CandidateSnapshot = {
  id: string;
  matchId: string;
  market: string;
  line: number | null;
  lineKey: string;
  horizon: string;
  selection: string;
  confidence: number;
  calibratedProbability: number;
  publishScore: number;
  edge: number | null;
  freshnessScore: number | null;
  volatilityScore: number | null;
  providerDisagreement: number | null;
  lineupCoverage: number | null;
  eventCoverage: number | null;
  strategyProfile: StrategyProfileKey;
  coverageFlags: CandidateCoverageFlags;
  leagueId: string | null;
};

export type SelectionScoreBreakdown = {
  confidenceComponent: number;
  probabilitySharpnessComponent: number;
  edgeComponent: number;
  freshnessComponent: number;
  coverageComponent: number;
  volatilityPenalty: number;
  disagreementPenalty: number;
};
