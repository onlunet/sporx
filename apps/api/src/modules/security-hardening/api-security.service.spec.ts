import { APISecurityService } from "./api-security.service";

describe("APISecurityService", () => {
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
      rateLimitBucket: {
        upsert: jest.fn()
      }
    } as any;
    const securityEventService = {
      resolveRequestContext: jest.fn().mockReturnValue({}),
      emitAbuseEvent: jest.fn().mockResolvedValue({ id: "abuse-1" })
    } as any;
    return {
      service: new APISecurityService(prisma, securityEventService),
      prisma
    };
  }

  it("blocks weak CORS patterns in production", () => {
    process.env.APP_ENV = "production";
    process.env.CORS_ORIGINS = "*,http://localhost:3000";
    const { service } = createService();
    const result = service.validateCorsPolicyForEnvironment("production");
    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("sanitizes sensitive error messages", () => {
    const { service } = createService();
    expect(service.sanitizeErrorMessage(400, "invalid secret token")).toBe("Request failed");
    expect(service.sanitizeErrorMessage(500, "stack trace")).toBe("Internal server error");
  });

  it("records rate-limit bucket telemetry", async () => {
    const { service, prisma } = createService();
    await service.recordRateLimitBucket({
      ruleId: "auth-login",
      limit: 10,
      hits: 11,
      remainingSeconds: 60,
      blocked: true,
      ipAddress: "127.0.0.1"
    });
    expect(prisma.rateLimitBucket.upsert).toHaveBeenCalled();
  });

  it("sets production security headers", () => {
    process.env.APP_ENV = "production";
    const { service } = createService();
    const headers = service.buildSecurityHeaders();
    expect(headers["Strict-Transport-Security"]).toContain("max-age");
    expect(headers["Content-Security-Policy"]).toContain("default-src");
  });
});
