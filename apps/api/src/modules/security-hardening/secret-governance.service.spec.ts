import { AccessActorType, SecretCategory, SecretLifecycleStatus } from "@prisma/client";
import { SecretGovernanceService } from "./secret-governance.service";

describe("SecretGovernanceService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createService() {
    const prisma = {
      secretRotationEvent: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({ id: "rotation-1" })
      }
    } as any;
    const securityEventService = {
      emitAuditEvent: jest.fn().mockResolvedValue({ id: "audit-1" }),
      emitSecurityEvent: jest.fn().mockResolvedValue({ id: "security-1" })
    } as any;
    return {
      service: new SecretGovernanceService(prisma, securityEventService),
      prisma,
      securityEventService
    };
  }

  it("masks secret-shaped values in records", () => {
    const { service } = createService();
    const redacted = service.redactSecrets({
      apiKey: "abcdefghijklmnopqrstuvwxyz",
      nested: { password: "1234567890" }
    });
    expect((redacted as any).apiKey).toContain("*");
    expect((redacted as any).nested.password).toContain("*");
  });

  it("fails startup check when required production secrets are missing", () => {
    const { service } = createService();
    process.env.APP_ENV = "production";
    delete process.env.DATABASE_URL;
    delete process.env.REDIS_URL;
    const result = service.validateRequiredSecrets();
    expect(result.ok).toBe(false);
    expect(result.missingSecrets).toContain("DATABASE_URL");
    expect(result.missingSecrets).toContain("REDIS_URL");
  });

  it("records secret rotation metadata and emits audit/security events", async () => {
    const { service, prisma, securityEventService } = createService();
    await service.recordSecretRotation({
      category: SecretCategory.JWT_SIGNING_KEY,
      secretRef: "jwt.signing.current",
      lifecycleStatus: SecretLifecycleStatus.ACTIVE,
      actorType: AccessActorType.ADMIN,
      actorId: "user-1"
    });
    expect(prisma.secretRotationEvent.create).toHaveBeenCalled();
    expect(securityEventService.emitAuditEvent).toHaveBeenCalled();
    expect(securityEventService.emitSecurityEvent).toHaveBeenCalled();
  });
});
