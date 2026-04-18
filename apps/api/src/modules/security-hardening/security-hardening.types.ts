import { AccessActorType, QueueAccessScopeClass, SecurityScanRunStatus, SecretCategory, SecretLifecycleStatus, VulnerabilityDisposition, VulnerabilitySeverity } from "@prisma/client";

export type SecurityHardeningContext = {
  requestId?: string | null;
  correlationId?: string | null;
  traceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  environment?: string | null;
};

export type SecretStartupCheckResult = {
  ok: boolean;
  environment: string;
  checkedAt: string;
  missingSecrets: string[];
  insecureSecrets: string[];
};

export type SecretRotationInput = {
  rotationKey?: string | null;
  category: SecretCategory;
  secretRef: string;
  lifecycleStatus: SecretLifecycleStatus;
  reason?: string | null;
  plannedAt?: Date | null;
  activatedAt?: Date | null;
  retiringAt?: Date | null;
  revokedAt?: Date | null;
  actorType?: AccessActorType | null;
  actorId?: string | null;
  serviceIdentityId?: string | null;
  metadata?: Record<string, unknown> | null;
  context?: SecurityHardeningContext;
};

export type QueueAuthorizationInput = {
  queueName: string;
  serviceIdentityId: string;
  mode: "enqueue" | "process";
  jobName?: string | null;
  environment?: string | null;
};

export type QueuePayloadValidationInput = {
  queueName: string;
  jobName: string;
  payload: Record<string, unknown>;
  mode: "enqueue" | "process";
  serviceIdentityId?: string | null;
  context?: SecurityHardeningContext;
};

export type QueuePayloadValidationResult = {
  queueName: string;
  jobName: string;
  payload: Record<string, unknown>;
  serviceIdentityId: string;
};

export type RuntimeHardeningCheck = {
  key: string;
  status: "PASS" | "WARN" | "FAIL";
  detail: string;
};

export type RuntimeHardeningReport = {
  environment: "development" | "staging" | "production";
  generatedAt: string;
  checks: RuntimeHardeningCheck[];
  failedCritical: boolean;
};

export type IngestScanRunInput = {
  runKey?: string | null;
  source: string;
  status?: SecurityScanRunStatus;
  startedAt?: Date | null;
  completedAt?: Date | null;
  summary?: Record<string, unknown> | null;
  environment?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type IngestVulnerabilityInput = {
  findingKey?: string | null;
  scanRunId?: string | null;
  packageName: string;
  packageVersion: string;
  advisoryId?: string | null;
  severity: VulnerabilitySeverity;
  title: string;
  description?: string | null;
  fixedVersion?: string | null;
  cvssScore?: number | null;
  disposition?: VulnerabilityDisposition;
  environment?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type QueueScopeInput = {
  queueName: string;
  serviceIdentityId: string;
  scopeClass: QueueAccessScopeClass;
  allowEnqueue: boolean;
  allowProcess: boolean;
  allowedJobs?: string[] | null;
  environment: string;
  metadata?: Record<string, unknown> | null;
};
