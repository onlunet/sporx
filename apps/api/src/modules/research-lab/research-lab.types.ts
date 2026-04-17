import { PolicyCandidateStatus, PolicyPromotionDecisionStatus, ResearchRunStatus, StrategyObjective, TuningSearchType } from "@prisma/client";

export type StrategyScope = {
  sport: string;
  leagueIds?: string[];
  markets?: string[];
  horizons?: string[];
};

export type StrategyConfig = {
  minConfidence: number;
  minPublishScore: number;
  minEdge: number;
  volatilityCap: number;
  coverageThreshold: number;
  lineupRequiredHorizons: string[];
  maxPicksPerMatch: number;
  kellyFraction: number;
  hardCapPerBet: number;
  dailyStopLoss: number;
  weeklyDrawdownStop: number;
  exposureLimit: number;
  correlationSuppression: number;
};

export type ObjectiveConstraint = {
  metric: string;
  op: "gte" | "lte";
  value: number;
};

export type ObjectiveDefinition = {
  primary: StrategyObjective;
  secondary: string[];
  weights?: Record<string, number>;
  constraints?: ObjectiveConstraint[];
};

export type TimeWindow = {
  key: string;
  trainStart: Date;
  trainEnd: Date;
  validationStart: Date;
  validationEnd: Date;
  testStart: Date;
  testEnd: Date;
};

export type TuningSearchSpaceDefinition = {
  type: TuningSearchType;
  grid?: Record<string, number[]>;
  random?: Record<string, { min: number; max: number; step?: number }>;
  maxTrials?: number;
};

export type TrialPlan = {
  trialNumber: number;
  trialKey: string;
  seed: number;
  config: Record<string, number | string | boolean>;
  configHash: string;
};

export type TrialMetricSet = {
  turnover: number;
  roi: number;
  yield: number;
  hitRate: number;
  logLoss: number;
  brierScore: number;
  maxDrawdown: number;
  riskOfRuin: number;
  abstainRate: number;
  publishRate: number;
  fallbackRate: number;
  breachRate: number;
};

export type TrialScoreResult = {
  score: number;
  passedConstraints: boolean;
  constraintFailures: string[];
};

export type RobustnessCheckResult = {
  checkName: string;
  passed: boolean;
  score: number;
  details: Record<string, unknown>;
};

export type RobustnessSummary = {
  score: number;
  unstable: boolean;
  flags: string[];
  reasons: string[];
  checks: RobustnessCheckResult[];
};

export type PolicyCandidateEvaluation = {
  sampleSize: number;
  minimumSampleSize: number;
  robustnessScore: number;
  minimumRobustnessScore: number;
  hasOverfitFlag: boolean;
  hasSegmentFailure: boolean;
  auditComplete: boolean;
};

export type PolicyGateDecision = {
  status: PolicyPromotionDecisionStatus;
  reasons: string[];
  approved: boolean;
};

export type ResearchSettings = {
  researchLabEnabled: boolean;
  autoTuningEnabled: boolean;
  trialPruningEnabled: boolean;
  policyCandidateRegistryEnabled: boolean;
  policyShadowPromotionEnabled: boolean;
  policyCanaryPromotionEnabled: boolean;
};

export type CandidateRegistrationInput = {
  projectId: string;
  experimentId: string;
  researchRunId: string;
  bestTrialId?: string | null;
  strategyConfigVersionId?: string | null;
  searchSpaceId?: string | null;
  robustnessTestRunId?: string | null;
  key: string;
  summary?: Record<string, unknown> | null;
  objectiveDefinition?: Record<string, unknown> | null;
  datasetHashes?: Record<string, unknown> | null;
  status?: PolicyCandidateStatus;
};

export type TrialPruningInput = {
  drawdown: number;
  riskOfRuin: number;
  roi: number;
  logLoss: number;
  sampleSize: number;
  config: {
    maxDrawdown: number;
    maxRiskOfRuin: number;
    minRoiFloor: number;
    maxLogLoss: number;
    minSampleForDecision: number;
  };
};

export type TrialPruningDecision = {
  pruned: boolean;
  reason: string | null;
};

export type RunComparisonRow = {
  runId: string;
  projectId: string;
  experimentId: string;
  status: ResearchRunStatus;
  objectiveMetric: string;
  datasetHashes: Record<string, unknown>;
  configVersionId: string | null;
  searchSpaceId: string | null;
  seed: number | null;
  metrics: Record<string, unknown>;
};
