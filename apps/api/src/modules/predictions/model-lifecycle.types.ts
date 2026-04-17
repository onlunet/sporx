import { DriftSeverity, PromotionDecisionStatus, ServingAliasType } from "@prisma/client";

export type ServingScope = {
  sport: string;
  market: string;
  line: number | null;
  lineKey: string;
  horizon: string;
  leagueId: string | null;
};

export type ServingResolution = {
  aliasType: ServingAliasType;
  modelVersionId: string | null;
  calibrationVersionId: string | null;
  featureSetVersion: string | null;
  policyVersion: string | null;
  scopeLeagueKey: string;
  resolvedViaAlias: boolean;
};

export type LifecycleFlags = {
  championAliasResolutionEnabled: boolean;
  challengerShadowEnabled: boolean;
  canaryEnabled: boolean;
  autoPromotionEnabled: boolean;
  autoRollbackEnabled: boolean;
  driftTriggeredRetrainingEnabled: boolean;
};

export type PromotionEvaluationInput = {
  sampleSize: number;
  minimumSampleSize: number;
  championLogLoss: number | null;
  challengerLogLoss: number | null;
  championBrier: number | null;
  challengerBrier: number | null;
  championCalibrationDrift: number | null;
  challengerCalibrationDrift: number | null;
  championLatencyP95Ms: number | null;
  challengerLatencyP95Ms: number | null;
  challengerFallbackRate: number | null;
  challengerErrorRate: number | null;
  maxLatencyP95Ms: number;
  maxFallbackRate: number;
  maxErrorRate: number;
  minLogLossImprovement: number;
  minBrierImprovement: number;
  maxCalibrationRegression: number;
};

export type PromotionEvaluationResult = {
  status: PromotionDecisionStatus;
  reasons: string[];
  minimumSampleSizeMet: boolean;
};

export type DriftComputationInput = {
  baseline: number;
  current: number;
  warningThreshold: number;
  criticalThreshold: number;
};

export type DriftComputationResult = {
  severity: DriftSeverity | null;
  delta: number;
};

export const LIFECYCLE_FLAG_KEYS = {
  championAliasResolutionEnabled: "champion_alias_resolution_enabled",
  challengerShadowEnabled: "challenger_shadow_enabled",
  canaryEnabled: "canary_enabled",
  autoPromotionEnabled: "auto_promotion_enabled",
  autoRollbackEnabled: "auto_rollback_enabled",
  driftTriggeredRetrainingEnabled: "drift_triggered_retraining_enabled"
} as const;
