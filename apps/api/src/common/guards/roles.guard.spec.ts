import { Reflector } from "@nestjs/core";
import { RolesGuard } from "./roles.guard";

describe("RolesGuard", () => {
  it("allows when no role metadata and governance disabled", async () => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) } as unknown as Reflector;
    const accessGovernanceService = {
      isEnabled: jest.fn().mockReturnValue(false)
    } as any;
    const guard = new RolesGuard(reflector, accessGovernanceService);
    const context: any = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: "user" }, method: "GET", path: "/api/v1/ping" }) })
    };

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("enforces role metadata", async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValueOnce(["admin"]).mockReturnValueOnce(undefined)
    } as unknown as Reflector;
    const accessGovernanceService = {
      isEnabled: jest.fn().mockReturnValue(false)
    } as any;
    const guard = new RolesGuard(reflector, accessGovernanceService);
    const context: any = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ user: { role: "viewer" }, method: "GET", path: "/api/v1/admin/models" }) })
    };

    await expect(guard.canActivate(context)).rejects.toThrow("Insufficient role scope");
  });

  it("blocks unauthenticated public request on admin role requirement", async () => {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValueOnce(["admin"]).mockReturnValueOnce(undefined)
    } as unknown as Reflector;
    const accessGovernanceService = {
      isEnabled: jest.fn().mockReturnValue(false)
    } as any;
    const guard = new RolesGuard(reflector, accessGovernanceService);
    const context: any = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => ({ method: "GET", path: "/api/v1/admin/security/access/policies" }) })
    };

    await expect(guard.canActivate(context)).rejects.toThrow("Insufficient role scope");
  });
});
