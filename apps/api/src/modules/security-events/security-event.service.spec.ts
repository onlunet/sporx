import {
  AccessActorType,
  AbuseEventType,
  SecurityAlertStatus,
  SecurityEventSeverity,
  SecurityEventSourceDomain
} from "@prisma/client";
import { SecurityEventService } from "./security-event.service";

describe("SecurityEventService", () => {
  let prisma: any;
  let service: SecurityEventService;

  beforeEach(() => {
    process.env.SECURITY_AUDIT_ENABLED = "true";
    process.env.SECURITY_EVENT_STREAM_ENABLED = "true";
    process.env.SECURITY_ALERTING_ENABLED = "true";

    prisma = {
      auditEvent: {
        findUnique: jest.fn(),
        create: jest.fn()
      },
      auditLog: {
        create: jest.fn()
      },
      securityEvent: {
        findUnique: jest.fn(),
        create: jest.fn(),
        count: jest.fn().mockResolvedValue(0)
      },
      securityAlert: {
        findUnique: jest.fn(),
        create: jest.fn()
      },
      abuseEvent: {
        findUnique: jest.fn(),
        create: jest.fn()
      }
    };

    service = new SecurityEventService(prisma);
  });

  afterEach(() => {
    delete process.env.SECURITY_AUDIT_ENABLED;
    delete process.env.SECURITY_EVENT_STREAM_ENABLED;
    delete process.env.SECURITY_ALERTING_ENABLED;
  });

  it("writes immutable audit event and legacy audit log", async () => {
    prisma.auditEvent.findUnique.mockResolvedValue(null);
    prisma.auditEvent.create.mockResolvedValue({ id: "audit-event-1" });
    prisma.auditLog.create.mockResolvedValue({ id: "legacy-audit-1" });

    const created = await service.emitAuditEvent({
      eventKey: "audit:test:1",
      actorType: AccessActorType.ADMIN,
      actorId: "admin-1",
      action: "security.policy.update",
      resourceType: "security",
      resourceId: "policy-1",
      reason: "test",
      severity: SecurityEventSeverity.HIGH
    });

    expect(created).toMatchObject({ id: "audit-event-1" });
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });

  it("emits alert on refresh token reuse security event", async () => {
    prisma.securityEvent.findUnique.mockResolvedValue(null);
    prisma.securityEvent.create.mockResolvedValue({
      id: "security-event-1",
      sourceDomain: SecurityEventSourceDomain.AUTH,
      eventType: "refresh_token_reuse",
      severity: SecurityEventSeverity.CRITICAL,
      actorId: "u1",
      ipAddress: "127.0.0.1",
      correlationId: null,
      traceId: null,
      requestId: null,
      environment: "production",
      createdAt: new Date()
    });
    prisma.securityAlert.findUnique.mockResolvedValue(null);
    prisma.securityAlert.create.mockResolvedValue({ id: "alert-1" });

    await service.emitSecurityEvent({
      eventKey: "security:refresh:1",
      sourceDomain: SecurityEventSourceDomain.AUTH,
      eventType: "refresh_token_reuse",
      severity: SecurityEventSeverity.CRITICAL,
      actorType: AccessActorType.USER,
      actorId: "u1"
    });

    expect(prisma.securityAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ruleKey: "refresh_token_reuse",
          severity: SecurityEventSeverity.CRITICAL,
          status: SecurityAlertStatus.OPEN
        })
      })
    );
  });

  it("persists abuse/rate-limit event and creates alert", async () => {
    prisma.abuseEvent.findUnique.mockResolvedValue(null);
    prisma.abuseEvent.create.mockResolvedValue({
      id: "abuse-1",
      path: "/api/v1/auth/login",
      ipAddress: "10.0.0.1",
      count: 42,
      windowSeconds: 60,
      correlationId: null,
      traceId: null,
      requestId: null,
      environment: "production",
      createdAt: new Date()
    });
    prisma.securityAlert.findUnique.mockResolvedValue(null);
    prisma.securityAlert.create.mockResolvedValue({ id: "alert-2" });

    const event = await service.emitAbuseEvent({
      eventKey: "abuse:1",
      eventType: AbuseEventType.RATE_LIMIT_EXCEEDED,
      sourceDomain: SecurityEventSourceDomain.RUNTIME,
      severity: SecurityEventSeverity.MEDIUM,
      path: "/api/v1/auth/login",
      method: "POST",
      count: 42,
      windowSeconds: 60,
      context: {
        ipAddress: "10.0.0.1",
        environment: "production"
      }
    });

    expect(event).toMatchObject({ id: "abuse-1" });
    expect(prisma.securityAlert.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          ruleKey: "abuse_rate_limit"
        })
      })
    );
  });
});
