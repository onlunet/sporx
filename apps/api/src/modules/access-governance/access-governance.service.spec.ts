import { AccessActorType, PermissionEffect } from "@prisma/client";
import { AccessGovernanceService } from "./access-governance.service";

describe("AccessGovernanceService", () => {
  const baseRequirement = {
    permission: "security.policy.write",
    resourceType: "security",
    action: "update",
    scope: {
      global: false,
      environment: "production"
    }
  };

  let prisma: any;
  let securityEventService: any;
  let service: AccessGovernanceService;

  beforeEach(() => {
    process.env.ACCESS_GOVERNANCE_ENABLED = "true";
    process.env.SCOPED_PERMISSION_ENFORCEMENT_ENABLED = "true";
    process.env.SERVICE_IDENTITY_SCOPE_ENFORCED = "true";

    prisma = {
      ipAllowlist: {
        findMany: jest.fn().mockResolvedValue([])
      },
      permissionGrant: {
        findMany: jest.fn().mockResolvedValue([])
      },
      serviceIdentityScope: {
        findMany: jest.fn().mockResolvedValue([])
      },
      accessPolicy: {
        findMany: jest.fn().mockResolvedValue([])
      },
      roleAssignment: {
        create: jest.fn(),
        update: jest.fn()
      }
    };

    securityEventService = {
      emitAuditEvent: jest.fn().mockResolvedValue({ id: "audit-1" }),
      emitSecurityEvent: jest.fn().mockResolvedValue({ id: "security-1" })
    };

    service = new AccessGovernanceService(prisma, securityEventService);
  });

  afterEach(() => {
    delete process.env.ACCESS_GOVERNANCE_ENABLED;
    delete process.env.SCOPED_PERMISSION_ENFORCEMENT_ENABLED;
    delete process.env.SERVICE_IDENTITY_SCOPE_ENFORCED;
    delete process.env.APP_ENV;
  });

  it("enables governance by default in production when env flag is unset", () => {
    delete process.env.ACCESS_GOVERNANCE_ENABLED;
    process.env.APP_ENV = "production";

    expect(service.isEnabled()).toBe(true);
  });

  it("keeps governance opt-in in development when env flag is unset", () => {
    delete process.env.ACCESS_GOVERNANCE_ENABLED;
    process.env.APP_ENV = "development";

    expect(service.isEnabled()).toBe(false);
  });

  it("denies by default when no policy or grant exists", async () => {
    const result = await service.evaluateAccess(
      {
        actorType: AccessActorType.USER,
        userId: "user-1",
        environment: "production",
        ipAddress: "10.0.0.10"
      },
      baseRequirement
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("deny_by_default");
  });

  it("allows only inside configured scope", async () => {
    prisma.permissionGrant.findMany.mockResolvedValue([
      {
        effect: PermissionEffect.ALLOW,
        scopeGlobal: false,
        scopeSport: "football",
        scopeLeagueId: "league-tr-super",
        scopeMarket: null,
        scopeHorizon: null,
        scopeEnvironment: "production"
      }
    ]);

    const allowed = await service.evaluateAccess(
      {
        actorType: AccessActorType.USER,
        userId: "user-2",
        environment: "production",
        ipAddress: "10.0.0.11"
      },
      {
        ...baseRequirement,
        scope: {
          ...baseRequirement.scope,
          sport: "football",
          leagueId: "league-tr-super"
        }
      }
    );
    expect(allowed.allowed).toBe(true);
    expect(allowed.source).toBe("grant");

    const denied = await service.evaluateAccess(
      {
        actorType: AccessActorType.USER,
        userId: "user-2",
        environment: "production",
        ipAddress: "10.0.0.11"
      },
      {
        ...baseRequirement,
        scope: {
          ...baseRequirement.scope,
          sport: "football",
          leagueId: "league-pl"
        }
      }
    );
    expect(denied.allowed).toBe(false);
  });

  it("does not treat admin actor as unrestricted", async () => {
    const result = await service.evaluateAccess(
      {
        actorType: AccessActorType.ADMIN,
        userId: "admin-1",
        role: "admin",
        environment: "production",
        ipAddress: "10.0.0.12"
      },
      {
        permission: "security.compliance.change",
        resourceType: "security",
        action: "update",
        scope: {
          global: true,
          environment: "production"
        }
      }
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("deny_by_default");
  });

  it("allows admin read fallback when governance storage query fails", async () => {
    prisma.permissionGrant.findMany.mockRejectedValueOnce(new Error("relation permission_grants does not exist"));

    const result = await service.evaluateAccess(
      {
        actorType: AccessActorType.ADMIN,
        userId: "admin-1",
        role: "super_admin",
        environment: "production",
        ipAddress: "10.0.0.12"
      },
      {
        permission: "security.runtime.read",
        resourceType: "security",
        action: "read",
        scope: {
          global: false,
          environment: "production"
        }
      }
    );

    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("governance_backend_error_admin_read_fallback");
  });

  it("denies non-read action when governance storage query fails", async () => {
    prisma.permissionGrant.findMany.mockRejectedValueOnce(new Error("relation permission_grants does not exist"));

    const result = await service.evaluateAccess(
      {
        actorType: AccessActorType.ADMIN,
        userId: "admin-2",
        role: "super_admin",
        environment: "production",
        ipAddress: "10.0.0.22"
      },
      {
        permission: "security.runtime.write",
        resourceType: "security",
        action: "update",
        scope: {
          global: true,
          environment: "production"
        }
      }
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("governance_backend_error");
  });

  it("blocks service identity for unauthorized privileged action", async () => {
    const result = await service.evaluateAccess(
      {
        actorType: AccessActorType.SERVICE,
        serviceIdentityId: "service-worker",
        environment: "production",
        ipAddress: "10.0.0.13"
      },
      {
        permission: "security.privileged_action.execute",
        resourceType: "security",
        action: "update",
        scope: {
          global: true,
          environment: "production"
        }
      }
    );

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("deny_by_default");
  });

  it("stores role assignment history with grant and revoke actors", async () => {
    prisma.roleAssignment.create.mockResolvedValue({
      id: "role-1",
      userId: "user-5",
      role: "analyst",
      grantedByUserId: "admin-2"
    });
    prisma.roleAssignment.update.mockResolvedValue({
      id: "role-1",
      revokedByUserId: "admin-3",
      revokedAt: new Date()
    });

    const granted = await service.assignRole({
      userId: "user-5",
      role: "analyst",
      scope: {
        sport: "football",
        environment: "production"
      },
      reason: "on-call access",
      grantedByUserId: "admin-2"
    });

    expect(granted).toMatchObject({
      userId: "user-5",
      role: "analyst"
    });
    expect(prisma.roleAssignment.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          grantedByUserId: "admin-2"
        })
      })
    );

    await service.revokeRoleAssignment("role-1", "admin-3", "access complete");
    expect(prisma.roleAssignment.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "role-1" },
        data: expect.objectContaining({
          revokedByUserId: "admin-3",
          reason: "access complete",
          revokedAt: expect.any(Date)
        })
      })
    );
    expect(securityEventService.emitAuditEvent).toHaveBeenCalled();
    expect(securityEventService.emitSecurityEvent).toHaveBeenCalled();
  });
});
