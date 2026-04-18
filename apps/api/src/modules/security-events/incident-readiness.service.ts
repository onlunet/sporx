import { ForbiddenException, Injectable } from "@nestjs/common";
import { AccessActorType, AuthActorType, IncidentEventType, IncidentStatus, Prisma, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { IncidentTimelineEventInput, SecurityRequestContext } from "./security-events.types";
import { SecurityEventService } from "./security-event.service";

const INCIDENT_TRANSITIONS: Record<IncidentStatus, IncidentStatus[]> = {
  OPEN: ["ACKNOWLEDGED", "MITIGATING", "RESOLVED", "CLOSED"],
  ACKNOWLEDGED: ["MITIGATING", "CONTAINED", "RESOLVED", "CLOSED"],
  MITIGATING: ["CONTAINED", "RESOLVED", "POSTMORTEM_PENDING", "CLOSED"],
  CONTAINED: ["RESOLVED", "POSTMORTEM_PENDING", "CLOSED"],
  RESOLVED: ["POSTMORTEM_PENDING", "CLOSED"],
  POSTMORTEM_PENDING: ["CLOSED"],
  CLOSED: []
};

type EmergencyControlName =
  | "disable_refresh_global"
  | "disable_admin_write_actions"
  | "admin_read_only_mode"
  | "disabled_provider_path"
  | "feature_flag_rollback";

const EMERGENCY_SETTING_KEYS: Record<EmergencyControlName, string> = {
  disable_refresh_global: "security.emergency.disable_refresh_global",
  disable_admin_write_actions: "security.emergency.disable_admin_write_actions",
  admin_read_only_mode: "security.emergency.admin_read_only_mode",
  disabled_provider_path: "security.emergency.disabled_provider_path",
  feature_flag_rollback: "security.emergency.feature_flag_rollback"
};

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

@Injectable()
export class IncidentReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService
  ) {}

  isIncidentReadinessEnabled() {
    return parseBoolean(process.env.INCIDENT_READINESS_ENABLED, true);
  }

  isEmergencyControlsEnabled() {
    return parseBoolean(process.env.EMERGENCY_CONTROLS_ENABLED, true);
  }

  private toJsonValue(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
    if (!value) {
      return undefined;
    }
    return value as Prisma.InputJsonValue;
  }

  async appendIncidentTimelineEvent(input: IncidentTimelineEventInput, tx?: Prisma.TransactionClient) {
    if (!this.isIncidentReadinessEnabled()) {
      throw new ForbiddenException("Incident readiness disabled");
    }

    const db = tx ?? this.prisma;
    const eventKey = input.eventKey?.trim();
    if (eventKey) {
      const existing = await db.incidentResponseEvent.findUnique({ where: { eventKey } });
      if (existing) {
        return existing;
      }
    }

    return db.incidentResponseEvent.create({
      data: {
        incidentId: input.incidentId,
        eventKey: eventKey ?? null,
        eventType: input.eventType,
        status: input.status,
        severity: input.severity,
        title: input.title,
        note: input.note ?? null,
        ownerUserId: input.ownerUserId ?? null,
        actorType: input.actorType ?? null,
        actorId: input.actorId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        action: input.action ?? null,
        targetResourceType: input.targetResourceType ?? null,
        targetResourceId: input.targetResourceId ?? null,
        relatedAuditEventId: input.relatedAuditEventId ?? null,
        relatedSecurityEventId: input.relatedSecurityEventId ?? null,
        relatedAlertId: input.relatedAlertId ?? null,
        scopeJson: this.toJsonValue(input.scope),
        policyVersionId: input.policyVersionId ?? null,
        decisionResult: input.decisionResult ?? null,
        reason: input.reason ?? null,
        correlationId: input.context?.correlationId ?? null,
        traceId: input.context?.traceId ?? null,
        requestId: input.context?.requestId ?? null,
        ipAddress: input.context?.ipAddress ?? null,
        userAgent: input.context?.userAgent ?? null,
        environment: input.context?.environment ?? null,
        metadata: this.toJsonValue(input.metadata)
      }
    });
  }

  async openIncident(input: {
    title: string;
    note?: string | null;
    severity: SecurityEventSeverity;
    ownerUserId?: string | null;
    actorType?: AccessActorType | null;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    eventKey?: string | null;
    reason?: string | null;
    context?: SecurityRequestContext;
    metadata?: Record<string, unknown> | null;
  }) {
    const incidentId = randomUUID();
    const timeline = await this.appendIncidentTimelineEvent({
      incidentId,
      eventKey: input.eventKey ?? null,
      eventType: IncidentEventType.OPENED,
      status: IncidentStatus.OPEN,
      severity: input.severity,
      title: input.title,
      note: input.note ?? null,
      ownerUserId: input.ownerUserId ?? null,
      actorType: input.actorType ?? null,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      reason: input.reason ?? null,
      context: input.context,
      metadata: input.metadata ?? null
    });

    await this.securityEventService.emitAuditEvent({
      eventKey: `audit:incident.open:${timeline.id}`,
      actorType: input.actorType ?? AccessActorType.SYSTEM,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "incident.open",
      resourceType: "incident",
      resourceId: incidentId,
      reason: input.reason ?? input.note ?? "incident_opened",
      severity: input.severity,
      context: input.context,
      metadata: {
        timelineEventId: timeline.id,
        ownerUserId: input.ownerUserId ?? null
      }
    });

    await this.securityEventService.emitSecurityEvent({
      eventKey: `security:incident.open:${timeline.id}`,
      sourceDomain: SecurityEventSourceDomain.COMPLIANCE,
      eventType: "incident_opened",
      severity: input.severity,
      actorType: input.actorType ?? AccessActorType.SYSTEM,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      targetResourceType: "incident",
      targetResourceId: incidentId,
      reason: input.reason ?? input.note ?? "incident_opened",
      context: input.context
    });

    return {
      incidentId,
      timeline
    };
  }

  async transitionIncident(input: {
    incidentId: string;
    status: IncidentStatus;
    actorType?: AccessActorType | null;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    ownerUserId?: string | null;
    note?: string | null;
    reason?: string | null;
    eventKey?: string | null;
    context?: SecurityRequestContext;
    metadata?: Record<string, unknown> | null;
  }) {
    const latest = await this.prisma.incidentResponseEvent.findFirst({
      where: { incidentId: input.incidentId },
      orderBy: { createdAt: "desc" }
    });
    if (!latest) {
      throw new ForbiddenException("Incident not found");
    }

    if (latest.status === input.status) {
      return latest;
    }

    const allowedTargets = INCIDENT_TRANSITIONS[latest.status] ?? [];
    if (!allowedTargets.includes(input.status)) {
      throw new ForbiddenException(`Invalid incident transition: ${latest.status} -> ${input.status}`);
    }

    const timeline = await this.appendIncidentTimelineEvent({
      incidentId: input.incidentId,
      eventKey: input.eventKey ?? null,
      eventType: IncidentEventType.STATUS_CHANGED,
      status: input.status,
      severity: latest.severity,
      title: `Incident status changed to ${input.status}`,
      note: input.note ?? null,
      ownerUserId: input.ownerUserId ?? latest.ownerUserId ?? null,
      actorType: input.actorType ?? null,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      reason: input.reason ?? null,
      context: input.context,
      metadata: {
        previousStatus: latest.status,
        ...(input.metadata ?? {})
      }
    });

    await this.securityEventService.emitAuditEvent({
      eventKey: `audit:incident.transition:${timeline.id}`,
      actorType: input.actorType ?? AccessActorType.SYSTEM,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "incident.transition",
      resourceType: "incident",
      resourceId: input.incidentId,
      decisionResult: input.status,
      reason: input.reason ?? null,
      severity: latest.severity,
      context: input.context,
      metadata: {
        previousStatus: latest.status,
        nextStatus: input.status,
        timelineEventId: timeline.id
      }
    });

    return timeline;
  }

  async addIncidentNote(input: {
    incidentId: string;
    note: string;
    actorType?: AccessActorType | null;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    reason?: string | null;
    eventKey?: string | null;
    context?: SecurityRequestContext;
    metadata?: Record<string, unknown> | null;
  }) {
    const latest = await this.prisma.incidentResponseEvent.findFirst({
      where: { incidentId: input.incidentId },
      orderBy: { createdAt: "desc" }
    });
    if (!latest) {
      throw new ForbiddenException("Incident not found");
    }

    return this.appendIncidentTimelineEvent({
      incidentId: input.incidentId,
      eventKey: input.eventKey ?? null,
      eventType: IncidentEventType.NOTE,
      status: latest.status,
      severity: latest.severity,
      title: "Incident note added",
      note: input.note,
      ownerUserId: latest.ownerUserId ?? null,
      actorType: input.actorType ?? null,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      reason: input.reason ?? null,
      context: input.context,
      metadata: input.metadata ?? null
    });
  }

  async listIncidents(limit = 200) {
    const events = await this.prisma.incidentResponseEvent.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: Math.max(1, Math.min(2000, limit * 20))
    });
    const map = new Map<string, (typeof events)[number]>();
    for (const event of events) {
      if (!map.has(event.incidentId)) {
        map.set(event.incidentId, event);
      }
      if (map.size >= limit) {
        break;
      }
    }
    return Array.from(map.values()).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  getIncidentTimeline(incidentId: string, limit = 500) {
    return this.prisma.incidentResponseEvent.findMany({
      where: { incidentId },
      orderBy: { createdAt: "asc" },
      take: Math.max(1, Math.min(limit, 2000))
    });
  }

  async isEmergencyControlActive(control: EmergencyControlName) {
    if (!this.isEmergencyControlsEnabled()) {
      return false;
    }
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key: EMERGENCY_SETTING_KEYS[control] }
    });
    if (!setting) {
      return false;
    }
    if (typeof setting.value === "boolean") {
      return setting.value;
    }
    if (typeof setting.value === "string") {
      return setting.value.trim().toLowerCase() === "true";
    }
    return false;
  }

  async getEmergencyControlStatus() {
    const keys = Object.values(EMERGENCY_SETTING_KEYS);
    const settings = await this.prisma.systemSetting.findMany({
      where: { key: { in: keys } }
    });
    const byKey = new Map(settings.map((item) => [item.key, item.value]));

    return {
      disableRefreshGlobal: byKey.get(EMERGENCY_SETTING_KEYS.disable_refresh_global) ?? false,
      disableAdminWriteActions: byKey.get(EMERGENCY_SETTING_KEYS.disable_admin_write_actions) ?? false,
      adminReadOnlyMode: byKey.get(EMERGENCY_SETTING_KEYS.admin_read_only_mode) ?? false,
      disabledProviderPath: byKey.get(EMERGENCY_SETTING_KEYS.disabled_provider_path) ?? null,
      featureFlagRollback: byKey.get(EMERGENCY_SETTING_KEYS.feature_flag_rollback) ?? null
    };
  }

  private async upsertEmergencySetting(key: string, value: Prisma.InputJsonValue) {
    return this.prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value }
    });
  }

  async activateEmergencyControl(input: {
    control: EmergencyControlName;
    enabled: boolean;
    actorType: AccessActorType;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    reason: string;
    incidentId?: string | null;
    context?: SecurityRequestContext;
    metadata?: Record<string, unknown> | null;
  }) {
    if (!this.isEmergencyControlsEnabled()) {
      throw new ForbiddenException("Emergency controls disabled");
    }

    const key = EMERGENCY_SETTING_KEYS[input.control];
    await this.upsertEmergencySetting(key, input.enabled);

    const audit = await this.securityEventService.emitAuditEvent({
      eventKey: `audit:emergency_control:${input.control}:${input.enabled}:${Date.now()}`,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: input.enabled ? "emergency_control.activate" : "emergency_control.deactivate",
      resourceType: "system_setting",
      resourceId: key,
      reason: input.reason,
      severity: SecurityEventSeverity.CRITICAL,
      context: input.context,
      metadata: {
        control: input.control,
        enabled: input.enabled,
        ...(input.metadata ?? {})
      }
    });

    const securityEvent = await this.securityEventService.emitSecurityEvent({
      eventKey: `security:emergency_control:${input.control}:${input.enabled}:${Date.now()}`,
      sourceDomain: SecurityEventSourceDomain.COMPLIANCE,
      eventType: input.enabled ? "emergency_control_activated" : "emergency_control_deactivated",
      severity: SecurityEventSeverity.CRITICAL,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      targetResourceType: "system_setting",
      targetResourceId: key,
      reason: input.reason,
      context: input.context,
      metadata: {
        control: input.control,
        enabled: input.enabled,
        ...(input.metadata ?? {})
      }
    });

    if (input.incidentId) {
      await this.appendIncidentTimelineEvent({
        incidentId: input.incidentId,
        eventType: IncidentEventType.EMERGENCY_CONTROL,
        status: IncidentStatus.MITIGATING,
        severity: SecurityEventSeverity.CRITICAL,
        title: `Emergency control ${input.control} ${input.enabled ? "enabled" : "disabled"}`,
        note: input.reason,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        action: input.enabled ? "emergency_control.activate" : "emergency_control.deactivate",
        targetResourceType: "system_setting",
        targetResourceId: key,
        relatedAuditEventId: audit?.id ?? null,
        relatedSecurityEventId: securityEvent?.id ?? null,
        reason: input.reason,
        context: input.context,
        metadata: input.metadata ?? null
      });
    }

    return {
      key,
      enabled: input.enabled,
      auditEventId: audit?.id ?? null,
      securityEventId: securityEvent?.id ?? null
    };
  }

  async revokeSessionsByScope(input: {
    actorType: AccessActorType;
    actorId?: string | null;
    reason: string;
    scope?: {
      actorType?: AuthActorType | null;
      userId?: string | null;
      environment?: string | null;
    };
    incidentId?: string | null;
    context?: SecurityRequestContext;
  }) {
    if (!this.isEmergencyControlsEnabled()) {
      throw new ForbiddenException("Emergency controls disabled");
    }

    const now = new Date();
    const where: Prisma.AuthSessionWhereInput = {
      status: "ACTIVE",
      ...(input.scope?.actorType ? { actorType: input.scope.actorType } : {}),
      ...(input.scope?.userId ? { userId: input.scope.userId } : {}),
      ...(input.scope?.environment ? { environment: input.scope.environment } : {})
    };

    const sessions = await this.prisma.authSession.findMany({
      where,
      select: { id: true }
    });
    const sessionIds = sessions.map((item) => item.id);
    if (sessionIds.length === 0) {
      return {
        revokedSessions: 0,
        revokedTokens: 0,
        revokedFamilies: 0
      };
    }

    const [sessionResult, tokenResult, familyResult] = await this.prisma.$transaction([
      this.prisma.authSession.updateMany({
        where: { id: { in: sessionIds }, status: "ACTIVE" },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedReason: input.reason
        }
      }),
      this.prisma.refreshToken.updateMany({
        where: {
          sessionId: { in: sessionIds },
          revokedAt: null
        },
        data: {
          revokedAt: now,
          revokedReason: input.reason
        }
      }),
      this.prisma.refreshTokenFamily.updateMany({
        where: {
          sessionId: { in: sessionIds },
          status: "ACTIVE"
        },
        data: {
          status: "REVOKED",
          revokedAt: now,
          revokedReason: input.reason
        }
      })
    ]);

    const audit = await this.securityEventService.emitAuditEvent({
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      action: "emergency_control.revoke_sessions",
      resourceType: "auth_session",
      reason: input.reason,
      severity: SecurityEventSeverity.CRITICAL,
      context: input.context,
      metadata: {
        scope: input.scope ?? null,
        revokedSessions: sessionResult.count,
        revokedTokens: tokenResult.count,
        revokedFamilies: familyResult.count
      }
    });

    const securityEvent = await this.securityEventService.emitSecurityEvent({
      sourceDomain: SecurityEventSourceDomain.AUTH,
      eventType: "sessions_revoked_by_scope",
      severity: SecurityEventSeverity.CRITICAL,
      actorType: input.actorType,
      actorId: input.actorId ?? null,
      targetResourceType: "auth_session",
      reason: input.reason,
      context: input.context,
      metadata: {
        scope: input.scope ?? null,
        revokedSessions: sessionResult.count,
        revokedTokens: tokenResult.count,
        revokedFamilies: familyResult.count
      }
    });

    if (input.incidentId) {
      await this.appendIncidentTimelineEvent({
        incidentId: input.incidentId,
        eventType: IncidentEventType.EMERGENCY_CONTROL,
        status: IncidentStatus.MITIGATING,
        severity: SecurityEventSeverity.CRITICAL,
        title: "Sessions revoked by scope",
        note: input.reason,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        action: "emergency_control.revoke_sessions",
        targetResourceType: "auth_session",
        relatedAuditEventId: audit?.id ?? null,
        relatedSecurityEventId: securityEvent?.id ?? null,
        context: input.context,
        metadata: {
          revokedSessions: sessionResult.count,
          revokedTokens: tokenResult.count,
          revokedFamilies: familyResult.count
        }
      });
    }

    return {
      revokedSessions: sessionResult.count,
      revokedTokens: tokenResult.count,
      revokedFamilies: familyResult.count
    };
  }
}
