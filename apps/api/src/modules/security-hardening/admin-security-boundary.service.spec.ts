import { ForbiddenException } from "@nestjs/common";
import { AdminSecurityBoundaryService } from "./admin-security-boundary.service";

describe("AdminSecurityBoundaryService", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.ADMIN_SECURITY_BOUNDARY_ENABLED = "true";
    process.env.ADMIN_ALLOWED_ORIGINS = "http://localhost:3100";
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("blocks public authority header on admin APIs", async () => {
    const securityEventService = {
      resolveRequestContext: jest.fn().mockReturnValue({}),
      emitAbuseEvent: jest.fn().mockResolvedValue({ id: "abuse-1" })
    } as any;
    const service = new AdminSecurityBoundaryService(securityEventService);

    await expect(
      service.assertAdminBoundary({
        path: "/api/v1/admin/security/events",
        headers: {
          "x-public-web-request": "1",
          origin: "http://localhost:3000"
        },
        method: "GET",
        ip: "127.0.0.1"
      } as any)
    ).rejects.toThrow(ForbiddenException);
  });
});
