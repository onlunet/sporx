import { StorageSecurityService } from "./storage-security.service";

describe("StorageSecurityService", () => {
  function createService() {
    const securityEventService = {
      emitAuditEvent: jest.fn().mockResolvedValue({ id: "audit-1" })
    } as any;
    return new StorageSecurityService(securityEventService);
  }

  it("builds cache keys without exposing raw sensitive values", () => {
    const service = createService();
    const key = service.buildSafeCacheKey({
      namespace: "security",
      bucket: "sessions",
      parts: ["user-1", "refresh_token=abcd1234supersecret"]
    });
    expect(key).toContain("sporx:");
    expect(key).not.toContain("supersecret");
  });

  it("throws when unsafe sensitive token appears in a cache key", () => {
    const service = createService();
    expect(() => service.assertSafeCacheKey("sporx:production:security:token:abc")).toThrow(
      "Sensitive token detected in cache key"
    );
  });

  it("returns configured ttl defaults", () => {
    const service = createService();
    expect(service.defaultTtlFor("rate_limit")).toBe(60);
    expect(service.defaultTtlFor("auth_session")).toBe(900);
  });
});
