import { AccessActorType, IncidentStatus, SecurityEventSeverity } from "@prisma/client";
import { IncidentReadinessService } from "./incident-readiness.service";

describe("IncidentReadinessService", () => {
  let prisma: any;
  let securityEventService: any;
  let service: IncidentReadinessService;

  beforeEach(() => {
    process.env.INCIDENT_READINESS_ENABLED = "true";
    process.env.EMERGENCY_CONTROLS_ENABLED = "true";

    const incidentEvents: any[] = [];
    const systemSettings = new Map<string, any>();

    prisma = {
      incidentResponseEvent: {
        findUnique: jest.fn(async ({ where }: any) =>
          incidentEvents.find((item) => item.eventKey === where.eventKey) ?? null
        ),
        create: jest.fn(async ({ data }: any) => {
          const created = {
            id: `incident-event-${incidentEvents.length + 1}`,
            createdAt: new Date(),
            ...data
          };
          incidentEvents.push(created);
          return created;
        }),
        findFirst: jest.fn(async ({ where, orderBy }: any) => {
          const rows = incidentEvents.filter((item) => item.incidentId === where.incidentId);
          if (rows.length === 0) {
            return null;
          }
          const sorted = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
          return orderBy?.createdAt === "desc" ? sorted[sorted.length - 1] : sorted[0];
        }),
        findMany: jest.fn(async ({ where, orderBy }: any) => {
          const rows = where?.incidentId
            ? incidentEvents.filter((item) => item.incidentId === where.incidentId)
            : [...incidentEvents];
          return [...rows].sort((a, b) =>
            orderBy?.createdAt === "desc"
              ? b.createdAt.getTime() - a.createdAt.getTime()
              : a.createdAt.getTime() - b.createdAt.getTime()
          );
        })
      },
      systemSetting: {
        findUnique: jest.fn(async ({ where }: any) =>
          systemSettings.has(where.key) ? { key: where.key, value: systemSettings.get(where.key) } : null
        ),
        findMany: jest.fn(async ({ where }: any) =>
          (where?.key?.in ?? []).filter((key: string) => systemSettings.has(key)).map((key: string) => ({ key, value: systemSettings.get(key) }))
        ),
        upsert: jest.fn(async ({ where, create, update }: any) => {
          const value = update?.value ?? create?.value;
          systemSettings.set(where.key, value);
          return { key: where.key, value };
        })
      },
      authSession: {
        findMany: jest.fn().mockResolvedValue([{ id: "session-1" }, { id: "session-2" }]),
        updateMany: jest.fn().mockResolvedValue({ count: 2 })
      },
      refreshToken: {
        updateMany: jest.fn().mockResolvedValue({ count: 4 })
      },
      refreshTokenFamily: {
        updateMany: jest.fn().mockResolvedValue({ count: 2 })
      },
      $transaction: jest.fn(async (operations: any[]) => Promise.all(operations))
    };

    securityEventService = {
      emitAuditEvent: jest.fn().mockResolvedValue({ id: "audit-1" }),
      emitSecurityEvent: jest.fn().mockResolvedValue({ id: "security-1" })
    };

    service = new IncidentReadinessService(prisma, securityEventService);
  });

  afterEach(() => {
    delete process.env.INCIDENT_READINESS_ENABLED;
    delete process.env.EMERGENCY_CONTROLS_ENABLED;
  });

  it("opens, acknowledges, and resolves an incident with timeline events", async () => {
    const opened = await service.openIncident({
      title: "Token reuse burst",
      severity: SecurityEventSeverity.CRITICAL,
      actorType: AccessActorType.ADMIN,
      actorId: "admin-1",
      note: "Detected from auth telemetry"
    });

    const acknowledged = await service.transitionIncident({
      incidentId: opened.incidentId,
      status: IncidentStatus.ACKNOWLEDGED,
      actorType: AccessActorType.ADMIN,
      actorId: "admin-1",
      note: "On-call acknowledged"
    });
    expect(acknowledged.status).toBe(IncidentStatus.ACKNOWLEDGED);

    const resolved = await service.transitionIncident({
      incidentId: opened.incidentId,
      status: IncidentStatus.RESOLVED,
      actorType: AccessActorType.ADMIN,
      actorId: "admin-1",
      note: "Mitigation completed"
    });
    expect(resolved.status).toBe(IncidentStatus.RESOLVED);

    const timeline = await service.getIncidentTimeline(opened.incidentId);
    expect(timeline).toHaveLength(3);
  });

  it("activates emergency control and writes audit", async () => {
    const result = await service.activateEmergencyControl({
      control: "disable_refresh_global",
      enabled: true,
      actorType: AccessActorType.ADMIN,
      actorId: "admin-2",
      reason: "active incident mitigation"
    });

    expect(result.enabled).toBe(true);
    expect(prisma.systemSetting.upsert).toHaveBeenCalled();
    expect(securityEventService.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "emergency_control.activate"
      })
    );
  });

  it("revoke sessions by scope is persisted and auditable", async () => {
    const summary = await service.revokeSessionsByScope({
      actorType: AccessActorType.ADMIN,
      actorId: "admin-3",
      reason: "containment",
      scope: {
        actorType: AccessActorType.ADMIN
      }
    });

    expect(summary).toEqual({
      revokedSessions: 2,
      revokedTokens: 4,
      revokedFamilies: 2
    });
    expect(securityEventService.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "emergency_control.revoke_sessions"
      })
    );
  });

  it("deduplicates incident event retries by event key", async () => {
    const first = await service.appendIncidentTimelineEvent({
      incidentId: "incident-1",
      eventKey: "incident:event:1",
      eventType: "NOTE",
      status: "OPEN",
      severity: "LOW",
      title: "note",
      note: "retry-safe"
    });
    const second = await service.appendIncidentTimelineEvent({
      incidentId: "incident-1",
      eventKey: "incident:event:1",
      eventType: "NOTE",
      status: "OPEN",
      severity: "LOW",
      title: "note",
      note: "retry-safe"
    });

    expect(first.id).toBe(second.id);
    expect(prisma.incidentResponseEvent.create).toHaveBeenCalledTimes(1);
  });
});
