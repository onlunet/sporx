import { Injectable } from "@nestjs/common";
import {
  AccessActorType,
  AbuseEventType,
  Prisma,
  SecurityAlertStatus,
  SecurityEventSeverity,
  SecurityEventSourceDomain
} from "@prisma/client";
import { Request } from "express";
import { PrismaService } from "../../prisma/prisma.service";
import { AbuseEventInput, AuditEventInput, SecurityAlertInput, SecurityEventInput, SecurityRequestContext } from "./security-events.types";

type DbClient = PrismaService | Prisma.TransactionClient;

const ALERT_LOOKBACK_MS = {
  authFailures: 5 * 60 * 1000,
  breakGlass: 24 * 60 * 60 * 1000,
  privilegedDenied: 10 * 60 * 1000,
  accessDeniedSpike: 5 * 60 * 1000
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

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

@Injectable()
export class SecurityEventService {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Prisma.TransactionClient): DbClient {
    return tx ?? this.prisma;
  }

  isSecurityAuditEnabled() {
    return parseBoolean(process.env.SECURITY_AUDIT_ENABLED, true);
  }

  isSecurityEventStreamEnabled() {
    return parseBoolean(process.env.SECURITY_EVENT_STREAM_ENABLED, true);
  }

  isSecurityAlertingEnabled() {
    return parseBoolean(process.env.SECURITY_ALERTING_ENABLED, true);
  }

  resolveRequestContext(request?: Request): SecurityRequestContext {
    if (!request) {
      return {
        environment: normalizeString(process.env.APP_ENV) ?? normalizeString(process.env.NODE_ENV) ?? "development"
      };
    }

    const correlationHeader = request.headers["x-correlation-id"];
    const traceHeader = request.headers["x-trace-id"];
    const requestIdHeader = request.headers["x-request-id"];
    const forwardedFor = request.headers["x-forwarded-for"];

    const correlationId = Array.isArray(correlationHeader)
      ? normalizeString(correlationHeader[0])
      : normalizeString(correlationHeader);
    const traceId = Array.isArray(traceHeader) ? normalizeString(traceHeader[0]) : normalizeString(traceHeader);
    const requestId = Array.isArray(requestIdHeader)
      ? normalizeString(requestIdHeader[0])
      : normalizeString(requestIdHeader);
    const ipAddress = typeof forwardedFor === "string" && forwardedFor.trim()
      ? forwardedFor.split(",")[0]?.trim() ?? request.ip
      : request.ip;

    return {
      correlationId,
      traceId,
      requestId,
      ipAddress: normalizeString(ipAddress),
      userAgent: normalizeString(request.headers["user-agent"]),
      environment:
        normalizeString(request.headers["x-app-environment"]) ??
        normalizeString(request.headers["x-environment"]) ??
        normalizeString(process.env.APP_ENV) ??
        normalizeString(process.env.NODE_ENV) ??
        "development"
    };
  }

  private toJsonValue(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | undefined {
    if (!value) {
      return undefined;
    }
    return value as Prisma.InputJsonValue;
  }

  async emitAuditEvent(input: AuditEventInput, tx?: Prisma.TransactionClient) {
    if (!this.isSecurityAuditEnabled()) {
      return null;
    }

    const db = this.client(tx);
    const eventKey = normalizeString(input.eventKey);
    if (eventKey) {
      const existing = await db.auditEvent.findUnique({ where: { eventKey } });
      if (existing) {
        return existing;
      }
    }

    const created = await db.auditEvent.create({
      data: {
        eventKey,
        actorType: input.actorType,
        actorId: input.actorId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        action: input.action.trim(),
        resourceType: input.resourceType.trim(),
        resourceId: input.resourceId ?? null,
        scopeJson: this.toJsonValue(input.scope),
        policyVersionId: input.policyVersionId ?? null,
        decisionResult: input.decisionResult ?? null,
        reason: input.reason ?? null,
        severity: input.severity ?? SecurityEventSeverity.INFO,
        correlationId: input.context?.correlationId ?? null,
        traceId: input.context?.traceId ?? null,
        requestId: input.context?.requestId ?? null,
        ipAddress: input.context?.ipAddress ?? null,
        userAgent: input.context?.userAgent ?? null,
        environment: input.context?.environment ?? null,
        metadata: this.toJsonValue(input.metadata)
      }
    });

    // Backward-compatible legacy audit stream.
    await db.auditLog.create({
      data: {
        userId: input.actorId ?? null,
        action: input.action.trim(),
        resourceType: input.resourceType.trim(),
        resourceId: input.resourceId ?? null,
        metadata: this.toJsonValue({
          severity: input.severity ?? SecurityEventSeverity.INFO,
          decisionResult: input.decisionResult ?? null,
          reason: input.reason ?? null,
          ...(input.metadata ?? {})
        }),
        diff: this.toJsonValue(input.scope ?? undefined)
      }
    });

    return created;
  }

  async emitSecurityEvent(input: SecurityEventInput, tx?: Prisma.TransactionClient) {
    if (!this.isSecurityEventStreamEnabled()) {
      return null;
    }

    const db = this.client(tx);
    const eventKey = normalizeString(input.eventKey);
    if (eventKey) {
      const existing = await db.securityEvent.findUnique({ where: { eventKey } });
      if (existing) {
        return existing;
      }
    }

    const created = await db.securityEvent.create({
      data: {
        eventKey,
        sourceDomain: input.sourceDomain,
        eventType: input.eventType.trim(),
        severity: input.severity ?? SecurityEventSeverity.INFO,
        actorType: input.actorType ?? null,
        actorId: input.actorId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        targetResourceType: input.targetResourceType ?? null,
        targetResourceId: input.targetResourceId ?? null,
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

    if (this.isSecurityAlertingEnabled()) {
      await this.evaluateAlertRules(created, db);
    }
    return created;
  }

  async emitAbuseEvent(input: AbuseEventInput, tx?: Prisma.TransactionClient) {
    if (!this.isSecurityEventStreamEnabled()) {
      return null;
    }

    const db = this.client(tx);
    const eventKey = normalizeString(input.eventKey);
    if (eventKey) {
      const existing = await db.abuseEvent.findUnique({ where: { eventKey } });
      if (existing) {
        return existing;
      }
    }

    const created = await db.abuseEvent.create({
      data: {
        eventKey,
        eventType: input.eventType,
        sourceDomain: input.sourceDomain ?? SecurityEventSourceDomain.RUNTIME,
        severity: input.severity ?? SecurityEventSeverity.LOW,
        actorType: input.actorType ?? null,
        actorId: input.actorId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        targetResourceType: input.targetResourceType ?? null,
        targetResourceId: input.targetResourceId ?? null,
        method: input.method ?? null,
        path: input.path ?? null,
        reason: input.reason ?? null,
        count: Math.max(1, input.count ?? 1),
        windowSeconds: input.windowSeconds ?? null,
        correlationId: input.context?.correlationId ?? null,
        traceId: input.context?.traceId ?? null,
        requestId: input.context?.requestId ?? null,
        ipAddress: input.context?.ipAddress ?? null,
        userAgent: input.context?.userAgent ?? null,
        environment: input.context?.environment ?? null,
        metadata: this.toJsonValue(input.metadata)
      }
    });

    if (this.isSecurityAlertingEnabled() && input.eventType === AbuseEventType.RATE_LIMIT_EXCEEDED) {
      await this.createAlert(
        {
          alertKey: `abuse:rate_limit:${created.path ?? "unknown"}:${created.ipAddress ?? "unknown"}:${Math.floor(
            created.createdAt.getTime() / (5 * 60 * 1000)
          )}`,
          sourceDomain: SecurityEventSourceDomain.RUNTIME,
          ruleKey: "abuse_rate_limit",
          severity: SecurityEventSeverity.MEDIUM,
          title: "Rate limit ihlali tespit edildi",
          summary: "Aynı istemci kısa sürede limit üstü istek gönderdi.",
          reason: created.reason ?? "rate_limit_exceeded",
          context: {
            correlationId: created.correlationId,
            traceId: created.traceId,
            requestId: created.requestId,
            environment: created.environment
          },
          metadata: {
            path: created.path,
            method: created.method,
            ipAddress: created.ipAddress,
            count: created.count,
            windowSeconds: created.windowSeconds
          }
        },
        db
      );
    }

    return created;
  }

  async createAlert(input: SecurityAlertInput, tx?: Prisma.TransactionClient) {
    if (!this.isSecurityAlertingEnabled()) {
      return null;
    }

    const db = this.client(tx);
    const alertKey = normalizeString(input.alertKey);
    if (alertKey) {
      const existing = await db.securityAlert.findUnique({ where: { alertKey } });
      if (existing) {
        return existing;
      }
    }

    return db.securityAlert.create({
      data: {
        alertKey,
        sourceDomain: input.sourceDomain,
        ruleKey: input.ruleKey.trim(),
        severity: input.severity,
        status: input.status ?? SecurityAlertStatus.OPEN,
        title: input.title.trim(),
        summary: input.summary ?? null,
        eventId: input.eventId ?? null,
        ownerUserId: input.ownerUserId ?? null,
        correlationId: input.context?.correlationId ?? null,
        traceId: input.context?.traceId ?? null,
        requestId: input.context?.requestId ?? null,
        environment: input.context?.environment ?? null,
        reason: input.reason ?? null,
        metadata: this.toJsonValue(input.metadata)
      }
    });
  }

  async updateAlertStatus(alertId: string, status: SecurityAlertStatus, ownerUserId?: string | null) {
    const updates: Prisma.SecurityAlertUpdateInput = {
      status
    };
    if (ownerUserId) {
      updates.ownerUserId = ownerUserId;
    }
    if (status === SecurityAlertStatus.ACKNOWLEDGED) {
      updates.acknowledgedAt = new Date();
    }
    if (status === SecurityAlertStatus.RESOLVED || status === SecurityAlertStatus.SUPPRESSED) {
      updates.resolvedAt = new Date();
    }
    return this.prisma.securityAlert.update({
      where: { id: alertId },
      data: updates
    });
  }

  private async evaluateAlertRules(
    event: {
      id: string;
      sourceDomain: SecurityEventSourceDomain;
      eventType: string;
      severity: SecurityEventSeverity;
      actorId: string | null;
      ipAddress: string | null;
      correlationId: string | null;
      traceId: string | null;
      requestId: string | null;
      environment: string | null;
      createdAt: Date;
    },
    db: DbClient
  ) {
    const createdAt = event.createdAt;

    if (event.eventType === "refresh_token_reuse") {
      await this.createAlert(
        {
          alertKey: `auth:refresh_reuse:${event.id}`,
          sourceDomain: SecurityEventSourceDomain.AUTH,
          ruleKey: "refresh_token_reuse",
          severity: SecurityEventSeverity.CRITICAL,
          title: "Refresh token reuse tespit edildi",
          summary: "Token tekrar kullanımı güvenlik ihlali sinyali olabilir.",
          eventId: event.id,
          reason: "refresh_token_reuse",
          context: {
            correlationId: event.correlationId,
            traceId: event.traceId,
            requestId: event.requestId,
            environment: event.environment
          }
        },
        db as Prisma.TransactionClient
      );
    }

    if (event.eventType === "admin_login_failure" || event.eventType === "login_failure") {
      const threshold = 10;
      const since = new Date(createdAt.getTime() - ALERT_LOOKBACK_MS.authFailures);
      const count = await db.securityEvent.count({
        where: {
          sourceDomain: SecurityEventSourceDomain.AUTH,
          eventType: event.eventType,
          createdAt: { gte: since },
          ipAddress: event.ipAddress ?? undefined
        }
      });
      if (count >= threshold) {
        await this.createAlert(
          {
            alertKey: `auth:login_failures:${event.ipAddress ?? "unknown"}:${Math.floor(createdAt.getTime() / ALERT_LOOKBACK_MS.authFailures)}`,
            sourceDomain: SecurityEventSourceDomain.AUTH,
            ruleKey: "repeated_auth_failures",
            severity: SecurityEventSeverity.HIGH,
            title: "Tekrarlayan kimlik doğrulama hataları",
            summary: "Kısa süre içinde çok sayıda başarısız giriş denemesi tespit edildi.",
            eventId: event.id,
            reason: "repeated_auth_failures",
            context: {
              correlationId: event.correlationId,
              traceId: event.traceId,
              requestId: event.requestId,
              environment: event.environment
            },
            metadata: {
              ipAddress: event.ipAddress,
              count,
              windowMinutes: 5
            }
          },
          db as Prisma.TransactionClient
        );
      }
    }

    if (event.eventType === "privileged_action_denied") {
      const since = new Date(createdAt.getTime() - ALERT_LOOKBACK_MS.privilegedDenied);
      const count = await db.securityEvent.count({
        where: {
          eventType: "privileged_action_denied",
          createdAt: { gte: since }
        }
      });
      if (count >= 5) {
        await this.createAlert(
          {
            alertKey: `access:privileged_denied:${Math.floor(createdAt.getTime() / ALERT_LOOKBACK_MS.privilegedDenied)}`,
            sourceDomain: SecurityEventSourceDomain.ACCESS,
            ruleKey: "privileged_action_denied_spike",
            severity: SecurityEventSeverity.HIGH,
            title: "Privileged action denials arttı",
            summary: "Kısa zaman aralığında yetkili işlem reddi artışı gözlendi.",
            eventId: event.id,
            reason: "privileged_action_denied_spike",
            context: {
              correlationId: event.correlationId,
              traceId: event.traceId,
              requestId: event.requestId,
              environment: event.environment
            },
            metadata: {
              count,
              windowMinutes: 10
            }
          },
          db as Prisma.TransactionClient
        );
      }
    }

    if (event.eventType === "break_glass_granted") {
      const since = new Date(createdAt.getTime() - ALERT_LOOKBACK_MS.breakGlass);
      const count = await db.securityEvent.count({
        where: {
          eventType: "break_glass_granted",
          createdAt: { gte: since }
        }
      });
      if (count >= 3) {
        await this.createAlert(
          {
            alertKey: `access:break_glass:${Math.floor(createdAt.getTime() / ALERT_LOOKBACK_MS.breakGlass)}`,
            sourceDomain: SecurityEventSourceDomain.ACCESS,
            ruleKey: "repeated_break_glass_usage",
            severity: SecurityEventSeverity.HIGH,
            title: "Tekrarlayan break-glass kullanımı",
            summary: "24 saat içinde birden fazla emergency privilege yükseltmesi gerçekleşti.",
            eventId: event.id,
            reason: "repeated_break_glass_usage",
            context: {
              correlationId: event.correlationId,
              traceId: event.traceId,
              requestId: event.requestId,
              environment: event.environment
            },
            metadata: {
              count,
              windowHours: 24
            }
          },
          db as Prisma.TransactionClient
        );
      }
    }

    if (event.eventType === "access_denied") {
      const since = new Date(createdAt.getTime() - ALERT_LOOKBACK_MS.accessDeniedSpike);
      const count = await db.securityEvent.count({
        where: {
          eventType: "access_denied",
          createdAt: { gte: since }
        }
      });
      if (count >= 20) {
        await this.createAlert(
          {
            alertKey: `access:denied_spike:${Math.floor(createdAt.getTime() / ALERT_LOOKBACK_MS.accessDeniedSpike)}`,
            sourceDomain: SecurityEventSourceDomain.ACCESS,
            ruleKey: "policy_denial_spike",
            severity: SecurityEventSeverity.MEDIUM,
            title: "Policy denial spike",
            summary: "Politika deny kararlarında ani artış gözlemlendi.",
            eventId: event.id,
            reason: "policy_denial_spike",
            context: {
              correlationId: event.correlationId,
              traceId: event.traceId,
              requestId: event.requestId,
              environment: event.environment
            },
            metadata: {
              count,
              windowMinutes: 5
            }
          },
          db as Prisma.TransactionClient
        );
      }
    }
  }

  async listAuditEvents(limit = 200) {
    return this.prisma.auditEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 1000))
    });
  }

  async listSecurityEvents(limit = 200) {
    return this.prisma.securityEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 1000))
    });
  }

  async listSecurityAlerts(limit = 200) {
    return this.prisma.securityAlert.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 1000))
    });
  }

  async listAbuseEvents(limit = 200) {
    return this.prisma.abuseEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 1000))
    });
  }

  async listPrivilegedActionHistory(limit = 200) {
    return this.prisma.auditEvent.findMany({
      where: {
        OR: [
          { action: { startsWith: "privileged_action." } },
          { action: { startsWith: "break_glass." } }
        ]
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 1000))
    });
  }
}
