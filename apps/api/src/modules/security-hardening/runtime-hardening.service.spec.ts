import { RuntimeHardeningService } from "./runtime-hardening.service";

describe("RuntimeHardeningService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  function createService(secretCheck: { missingSecrets: string[]; insecureSecrets: string[] }) {
    const prisma = {
      releaseAttestation: {
        upsert: jest.fn()
      }
    } as any;
    const secretGovernanceService = {
      validateRequiredSecrets: jest.fn().mockReturnValue({
        ok: secretCheck.missingSecrets.length === 0 && secretCheck.insecureSecrets.length === 0,
        environment: "production",
        checkedAt: new Date().toISOString(),
        missingSecrets: secretCheck.missingSecrets,
        insecureSecrets: secretCheck.insecureSecrets
      })
    } as any;
    const apiSecurityService = {
      validateCorsPolicyForEnvironment: jest.fn().mockReturnValue({ ok: true, issues: [] }),
      isStrictSecurityHeadersEnabled: jest.fn().mockReturnValue(true)
    } as any;
    const securityEventService = {
      emitSecurityEvent: jest.fn().mockResolvedValue({ id: "evt-1" })
    } as any;
    return new RuntimeHardeningService(prisma, secretGovernanceService, apiSecurityService, securityEventService);
  }

  it("fails startup hardening when critical secret checks fail", async () => {
    process.env.APP_ENV = "production";
    const service = createService({
      missingSecrets: ["DATABASE_URL"],
      insecureSecrets: []
    });

    await expect(service.assertStartupHardeningOrThrow()).rejects.toThrow("Runtime hardening startup checks failed");
  });

  it("passes startup hardening when checks are healthy", async () => {
    process.env.APP_ENV = "production";
    const service = createService({
      missingSecrets: [],
      insecureSecrets: []
    });

    await expect(service.assertStartupHardeningOrThrow()).resolves.toBeUndefined();
  });
});
