import { AccessActorType, DataClassificationLevel, GovernanceRequestStatus, GovernanceRequestType, LegalBasisHook, PrivacyJobStatus, RetentionActionType } from "@prisma/client";

export type GovernanceContext = {
  requestId?: string | null;
  correlationId?: string | null;
  traceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  environment?: string | null;
};

export type ClassificationMapping = {
  domain: string;
  entity: string;
  fieldName: string;
  dataClass: DataClassificationLevel;
  redactionStrategy?: string | null;
  policyVersion: string;
  legalBasisHook?: LegalBasisHook | null;
  metadata?: Record<string, unknown> | null;
};

export type ComplianceDecisionInput = {
  operation: "retention_cleanup" | "privacy_export" | "privacy_delete" | "data_access";
  domain: string;
  dataClass?: DataClassificationLevel | null;
  policyVersion?: string | null;
  legalBasisHook?: LegalBasisHook | null;
  dryRun?: boolean;
  scope?: Record<string, unknown> | null;
  actorType?: AccessActorType | null;
  actorId?: string | null;
  serviceIdentityId?: string | null;
  reason?: string | null;
  context?: GovernanceContext;
};

export type ComplianceDecisionResult = {
  decisionKey: string;
  operation: ComplianceDecisionInput["operation"];
  policyVersion: string;
  approved: boolean;
  legalHoldBlocked: boolean;
  reason: string;
  dryRun: boolean;
  immutableGuard: boolean;
};

export type RetentionDryRunItem = {
  policyKey: string;
  domain: string;
  tableName: string | null;
  action: RetentionActionType;
  retentionDays: number;
  immutableProtected: boolean;
  legalHoldBlocked: boolean;
  candidateCount: number;
};

export type RetentionDryRunReport = {
  reportKey: string;
  generatedAt: string;
  dryRun: boolean;
  policyVersion: string;
  items: RetentionDryRunItem[];
  totals: {
    candidateCount: number;
    blockedCount: number;
    immutableProtectedCount: number;
  };
};

export type PrivacyRequestInput = {
  requestKey?: string | null;
  userId?: string | null;
  actorType?: AccessActorType | null;
  actorId?: string | null;
  serviceIdentityId?: string | null;
  targetDomain: string;
  targetEntity?: string | null;
  targetId?: string | null;
  requestType: GovernanceRequestType;
  legalBasisHook?: LegalBasisHook | null;
  policyVersion?: string | null;
  reason?: string | null;
  dryRun?: boolean;
  metadata?: Record<string, unknown> | null;
  context?: GovernanceContext;
};

export type PrivacyRequestStatusUpdate = {
  requestId: string;
  status: GovernanceRequestStatus;
  completedAt?: Date | null;
  metadata?: Record<string, unknown> | null;
};

export type PrivacyJobRequest = {
  jobKey?: string | null;
  requestId?: string | null;
  userId?: string | null;
  status?: PrivacyJobStatus;
  policyVersion?: string | null;
  legalBasisHook?: LegalBasisHook | null;
  dryRun?: boolean;
  legalHoldBlocked?: boolean;
  inputScope?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};
