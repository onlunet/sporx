import { AccessActorType, DataClassificationLevel, RetentionActionType } from "@prisma/client";
import { RetentionGovernanceService } from "./retention-governance.service";

describe("RetentionGovernanceService", () => {
  let prisma: any;
  let securityEventService: any;
  let complianceGovernanceService: any;
  let service: RetentionGovernanceService;

  beforeEach(() => {
    process.env.RETENTION_CLEANUP_ENABLED = "true";

    prisma = {
      retentionPolicy: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn()
      },
      authSession: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      loginAttempt: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      refreshTokenEvent: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      rawProviderPayload: {
        count: jest.fn().mockResolvedValue(0),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      researchRunArtifact: {
        count: jest.fn().mockResolvedValue(0),
        updateMany: jest.fn().mockResolvedValue({ count: 0 })
      },
      predictionRun: {
        count: jest.fn().mockResolvedValue(0)
      },
      auditEvent: {
        count: jest.fn().mockResolvedValue(0)
      },
      securityEvent: {
        count: jest.fn().mockResolvedValue(0)
      },
      abuseEvent: {
        count: jest.fn().mockResolvedValue(0)
      },
      apiLog: {
        count: jest.fn().mockResolvedValue(0)
      }
    };

    securityEventService = {
      emitAuditEvent: jest.fn().mockResolvedValue({ id: "audit-1" })
    };

    complianceGovernanceService = {
      resolvePolicyVersion: jest.fn().mockReturnValue("v1"),
      evaluatePolicy: jest.fn(async ({ scope, dryRun }: any) => ({
        decisionKey: `decision:${scope.policyKey}`,
        operation: "retention_cleanup",
        policyVersion: "v1",
        approved: true,
        legalHoldBlocked: false,
        reason: "policy_approved",
        dryRun,
        immutableGuard: false
      }))
    };

    service = new RetentionGovernanceService(prisma, securityEventService, complianceGovernanceService);
  });

  afterEach(() => {
    delete process.env.RETENTION_CLEANUP_ENABLED;
  });

  it("builds retention dry-run report with expected totals and deterministic key", async () => {
    prisma.retentionPolicy.findMany.mockResolvedValue([
      {
        policyKey: "retention.auth.auth_sessions",
        domain: "auth",
        tableName: "auth_sessions",
        retentionDays: 90,
        action: RetentionActionType.DELETE,
        immutableProtected: false,
        dataClass: DataClassificationLevel.CONFIDENTIAL,
        policyVersion: "v1",
        legalBasisHook: null
      },
      {
        policyKey: "retention.security.audit_events",
        domain: "security",
        tableName: "audit_events",
        retentionDays: 3650,
        action: RetentionActionType.ARCHIVE,
        immutableProtected: true,
        dataClass: DataClassificationLevel.RESTRICTED,
        policyVersion: "v1",
        legalBasisHook: null
      }
    ]);
    prisma.authSession.count.mockResolvedValue(3);
    prisma.auditEvent.count.mockResolvedValue(5);

    const first = await service.generateCleanupReport({ dryRun: true });
    const second = await service.generateCleanupReport({ dryRun: true });

    expect(first.totals).toEqual({
      candidateCount: 8,
      blockedCount: 0,
      immutableProtectedCount: 1
    });
    expect(first.reportKey).toBe(second.reportKey);
    expect(complianceGovernanceService.evaluatePolicy).toHaveBeenCalled();
  });

  it("protects immutable audit/security policies from execution", async () => {
    prisma.retentionPolicy.findMany.mockResolvedValue([
      {
        policyKey: "retention.security.audit_events",
        domain: "security",
        tableName: "audit_events",
        retentionDays: 3650,
        action: RetentionActionType.ARCHIVE,
        immutableProtected: true,
        dataClass: DataClassificationLevel.RESTRICTED,
        policyVersion: "v1",
        legalBasisHook: null
      }
    ]);
    prisma.auditEvent.count.mockResolvedValue(4);
    complianceGovernanceService.evaluatePolicy.mockResolvedValue({
      decisionKey: "decision:retention.security.audit_events",
      operation: "retention_cleanup",
      policyVersion: "v1",
      approved: false,
      legalHoldBlocked: false,
      reason: "immutable_data_cleanup_blocked",
      dryRun: false,
      immutableGuard: true
    });

    const result = await service.executeCleanup({
      dryRun: false,
      actorType: AccessActorType.SYSTEM
    });

    expect(result.executed).toBe(true);
    expect(result.deletedTotal).toBe(0);
    expect(result.anonymizedTotal).toBe(0);
    expect(result.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policyKey: "retention.security.audit_events",
          reason: "immutable_protected",
          blocked: true
        })
      ])
    );
    expect(prisma.authSession.deleteMany).not.toHaveBeenCalled();
    expect(securityEventService.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "compliance.retention.cleanup_execute"
      })
    );
  });
});
