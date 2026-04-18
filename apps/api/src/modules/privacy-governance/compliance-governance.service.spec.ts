import { DataClassificationLevel, LegalBasisHook } from "@prisma/client";
import { ComplianceGovernanceService } from "./compliance-governance.service";

describe("ComplianceGovernanceService", () => {
  let prisma: any;
  let securityEventService: any;
  let service: ComplianceGovernanceService;

  beforeEach(() => {
    process.env.PRIVACY_GOVERNANCE_ENABLED = "true";
    process.env.COMPLIANCE_POLICY_ENFORCED = "true";
    process.env.LEGAL_HOLD_HOOKS_ENABLED = "true";
    process.env.COMPLIANCE_POLICY_VERSION = "v1";
    process.env.LEGAL_HOLD_DOMAINS = "";

    prisma = {
      systemSetting: {
        findUnique: jest.fn().mockResolvedValue(null)
      },
      auditEvent: {
        findMany: jest.fn().mockResolvedValue([])
      }
    };

    securityEventService = {
      emitAuditEvent: jest.fn().mockResolvedValue({ id: "audit-1" }),
      emitSecurityEvent: jest.fn().mockResolvedValue({ id: "sec-1" })
    };

    service = new ComplianceGovernanceService(prisma, securityEventService);
  });

  afterEach(() => {
    delete process.env.PRIVACY_GOVERNANCE_ENABLED;
    delete process.env.COMPLIANCE_POLICY_ENFORCED;
    delete process.env.LEGAL_HOLD_HOOKS_ENABLED;
    delete process.env.COMPLIANCE_POLICY_VERSION;
    delete process.env.LEGAL_HOLD_DOMAINS;
  });

  it("policy-checks privacy deletion and emits audit/security events", async () => {
    const result = await service.evaluatePolicy({
      operation: "privacy_delete",
      domain: "auth",
      dataClass: DataClassificationLevel.PII,
      dryRun: false,
      scope: { requestKey: "delete-user-1" }
    });

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("missing_legal_basis_hook");
    expect(securityEventService.emitAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "compliance.policy.decision",
        decisionResult: "REJECTED"
      })
    );
    expect(securityEventService.emitSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "compliance_policy_decision",
        decisionResult: "REJECTED"
      })
    );
  });

  it("approves privacy export and keeps deterministic decision keys across retries", async () => {
    const input = {
      operation: "privacy_export" as const,
      domain: "user",
      dataClass: DataClassificationLevel.CONFIDENTIAL,
      dryRun: false,
      scope: { requestKey: "export-user-1", userId: "u-1" }
    };

    const first = await service.evaluatePolicy(input);
    const second = await service.evaluatePolicy(input);

    expect(first.approved).toBe(true);
    expect(second.approved).toBe(true);
    expect(first.reason).toBe("policy_approved");
    expect(first.decisionKey).toBe(second.decisionKey);
  });

  it("blocks destructive execution for legal-hold protected domains", async () => {
    process.env.LEGAL_HOLD_DOMAINS = "provider,security";

    const result = await service.evaluatePolicy({
      operation: "privacy_delete",
      domain: "provider",
      dataClass: DataClassificationLevel.RESTRICTED,
      legalBasisHook: LegalBasisHook.LEGAL_OBLIGATION,
      dryRun: false,
      scope: { requestKey: "delete-provider-1" }
    });

    expect(result.approved).toBe(false);
    expect(result.legalHoldBlocked).toBe(true);
    expect(result.reason).toBe("blocked_by_legal_hold");
  });
});
