import { AccessActorType, PermissionEffect, PrivilegedActionSeverity, PrivilegedActionStatus } from "@prisma/client";

export type AccessScope = {
  global?: boolean;
  sport?: string | null;
  leagueId?: string | null;
  market?: string | null;
  horizon?: string | null;
  environment?: string | null;
};

export type AccessRequirement = {
  permission: string;
  resourceType: string;
  action: string;
  scope?: AccessScope;
};

export type AccessActor = {
  actorType: AccessActorType;
  userId?: string;
  role?: string;
  serviceIdentityId?: string;
  environment: string;
  ipAddress?: string | null;
};

export type AccessEvaluationResult = {
  allowed: boolean;
  effect: PermissionEffect;
  reason: string;
  source: "grant" | "role_assignment" | "policy_matrix" | "service_scope" | "default";
};

export type PrivilegedActionRequestInput = {
  idempotencyKey: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  reason: string;
  severity: PrivilegedActionSeverity;
  scope?: AccessScope;
  environment?: string | null;
  metadata?: Record<string, unknown> | null;
  requiresStepUp?: boolean;
  requiresApproval?: boolean;
};

export type PrivilegedActionApprovalInput = {
  requestId: string;
  status: PrivilegedActionStatus;
  reason?: string | null;
};
