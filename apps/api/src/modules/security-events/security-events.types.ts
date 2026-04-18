import {
  AccessActorType,
  AbuseEventType,
  IncidentEventType,
  IncidentStatus,
  SecurityAlertStatus,
  SecurityEventSeverity,
  SecurityEventSourceDomain
} from "@prisma/client";

export type SecurityRequestContext = {
  correlationId?: string | null;
  traceId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  environment?: string | null;
};

export type AuditEventInput = {
  eventKey?: string | null;
  actorType: AccessActorType;
  actorId?: string | null;
  serviceIdentityId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  scope?: Record<string, unknown> | null;
  policyVersionId?: string | null;
  decisionResult?: string | null;
  reason?: string | null;
  severity?: SecurityEventSeverity;
  metadata?: Record<string, unknown> | null;
  context?: SecurityRequestContext;
};

export type SecurityEventInput = {
  eventKey?: string | null;
  sourceDomain: SecurityEventSourceDomain;
  eventType: string;
  severity?: SecurityEventSeverity;
  actorType?: AccessActorType | null;
  actorId?: string | null;
  serviceIdentityId?: string | null;
  targetResourceType?: string | null;
  targetResourceId?: string | null;
  scope?: Record<string, unknown> | null;
  policyVersionId?: string | null;
  decisionResult?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  context?: SecurityRequestContext;
};

export type SecurityAlertInput = {
  alertKey?: string | null;
  sourceDomain: SecurityEventSourceDomain;
  ruleKey: string;
  severity: SecurityEventSeverity;
  title: string;
  summary?: string | null;
  eventId?: string | null;
  ownerUserId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  status?: SecurityAlertStatus;
  context?: SecurityRequestContext;
};

export type AbuseEventInput = {
  eventKey?: string | null;
  eventType: AbuseEventType;
  sourceDomain?: SecurityEventSourceDomain;
  severity?: SecurityEventSeverity;
  actorType?: AccessActorType | null;
  actorId?: string | null;
  serviceIdentityId?: string | null;
  targetResourceType?: string | null;
  targetResourceId?: string | null;
  method?: string | null;
  path?: string | null;
  reason?: string | null;
  count?: number;
  windowSeconds?: number | null;
  metadata?: Record<string, unknown> | null;
  context?: SecurityRequestContext;
};

export type IncidentTimelineEventInput = {
  incidentId: string;
  eventKey?: string | null;
  eventType: IncidentEventType;
  status: IncidentStatus;
  severity: SecurityEventSeverity;
  title: string;
  note?: string | null;
  ownerUserId?: string | null;
  actorType?: AccessActorType | null;
  actorId?: string | null;
  serviceIdentityId?: string | null;
  action?: string | null;
  targetResourceType?: string | null;
  targetResourceId?: string | null;
  relatedAuditEventId?: string | null;
  relatedSecurityEventId?: string | null;
  relatedAlertId?: string | null;
  scope?: Record<string, unknown> | null;
  policyVersionId?: string | null;
  decisionResult?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown> | null;
  context?: SecurityRequestContext;
};
