export type RoleName = "super_admin" | "admin" | "analyst" | "viewer" | "user";

export interface ApiMeta {
  page?: number;
  limit?: number;
  total?: number;
  [key: string]: unknown;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown> | null;
}

export interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  meta: ApiMeta | null;
  error: ApiError | null;
}

export interface ProbabilityTriplet {
  home: number;
  draw: number;
  away: number;
}

export interface ExpectedScore {
  home: number;
  away: number;
}

export interface RiskFlag {
  code: string;
  severity: "low" | "medium" | "high";
  message: string;
}

export interface Prediction {
  matchId: string;
  probabilities: ProbabilityTriplet;
  expectedScore: ExpectedScore;
  rawProbabilities: ProbabilityTriplet;
  calibratedProbabilities: ProbabilityTriplet;
  rawConfidenceScore: number;
  calibratedConfidenceScore: number;
  confidenceScore: number;
  summary: string;
  riskFlags: RiskFlag[];
  isRecommended: boolean;
  isLowConfidence: boolean;
  avoidReason: string | null;
}

export interface PredictionExplanation {
  predictionId: string;
  reasoning: string[];
  keyFactors: string[];
}

export interface TeamComparisonAxis {
  key: string;
  homeValue: number;
  awayValue: number;
  advantage: "home" | "away" | "neutral";
}

export interface TeamComparisonResult {
  homeTeamId: string;
  awayTeamId: string;
  confidenceScore: number;
  summary: string;
  scenarioNotes: string[];
  axes: TeamComparisonAxis[];
}

export interface ProviderHealth {
  provider: string;
  status: "healthy" | "degraded" | "down";
  latencyMs: number;
  checkedAt: string;
  message?: string;
}

export interface IngestionRunStatus {
  id: string;
  jobType: string;
  status: "queued" | "running" | "succeeded" | "failed";
  startedAt?: string;
  finishedAt?: string;
  recordsRead: number;
  recordsWritten: number;
  errors: number;
}
