import { AuthActorType, SecurityEventSourceDomain } from "@prisma/client";
import { UnauthorizedException } from "@nestjs/common";
import bcrypt from "bcrypt";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const usersService = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    storeRefreshToken: jest.fn(),
    findRefreshTokenMatch: jest.fn(),
    findRefreshTokenByJti: jest.fn(),
    revokeRefreshTokenById: jest.fn(),
    revokeRefreshTokenFamily: jest.fn(),
    revokeAllActiveRefreshTokens: jest.fn(),
    revokeAuthSession: jest.fn(),
    revokeAllAuthSessions: jest.fn(),
    createLoginAttempt: jest.fn(),
    getRecentLoginFailures: jest.fn(),
    createAuthRiskEvent: jest.fn(),
    createAuthSession: jest.fn(),
    createRefreshTokenFamily: jest.fn(),
    touchRefreshTokenFamily: jest.fn(),
    touchAuthSession: jest.fn(),
    createRefreshTokenEvent: jest.fn(),
    markRefreshTokenRotated: jest.fn(),
    createAdminAccessSession: jest.fn(),
    markAdminAccessSessionSeen: jest.fn(),
    createAdminStepUpChallenge: jest.fn(),
    findAdminStepUpChallenge: jest.fn(),
    updateAdminStepUpChallenge: jest.fn(),
    findAuthSessions: jest.fn(),
    findAuthRiskEvents: jest.fn(),
    findLoginAttempts: jest.fn(),
    findRefreshTokenEvents: jest.fn()
  };

  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn()
  };

  const prismaService = {
    $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback({})),
    auditLog: {
      create: jest.fn()
    },
    adminAccessSession: {
      updateMany: jest.fn()
    }
  };

  const securityEventService = {
    emitSecurityEvent: jest.fn().mockResolvedValue({})
  };

  const incidentReadinessService = {
    isEmergencyControlActive: jest.fn().mockResolvedValue(false)
  };

  const service = new AuthService(
    usersService as any,
    jwtService as any,
    prismaService as any,
    securityEventService as any,
    incidentReadinessService as any
  );

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
    process.env.JWT_REFRESH_SECRET_ADMIN = "test-refresh-secret";
    process.env.AUTH_LOCKOUT_ENABLED = "true";
    process.env.REFRESH_REUSE_DETECTION_ENABLED = "true";
    incidentReadinessService.isEmergencyControlActive.mockResolvedValue(false);
  });

  it("sanitizes login error for unknown user", async () => {
    usersService.findByEmail.mockResolvedValue(null);
    usersService.getRecentLoginFailures.mockResolvedValue([]);
    usersService.createLoginAttempt.mockResolvedValue({});

    await expect(service.login("x@y.com", "pwd")).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.login("x@y.com", "pwd")).rejects.toThrow("Authentication failed");
    expect(usersService.createLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "x@y.com",
        result: "FAILURE"
      })
    );
  });

  it("blocks login when lockout is active", async () => {
    usersService.findByEmail.mockResolvedValue({
      id: "u1",
      email: "admin@example.com",
      passwordHash: "irrelevant",
      isActive: true,
      role: { name: "admin" }
    });
    usersService.getRecentLoginFailures.mockResolvedValue([
      {
        lockedUntil: new Date(Date.now() + 60_000)
      }
    ]);
    usersService.createLoginAttempt.mockResolvedValue({});

    await expect(service.login("admin@example.com", "pwd")).rejects.toThrow("Authentication failed");
    expect(usersService.createLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        actorType: AuthActorType.ADMIN,
        result: "LOCKED"
      })
    );
  });

  it("rotates refresh token when request is valid", async () => {
    jwtService.verifyAsync
      .mockResolvedValueOnce({ sub: "u1", role: "admin", type: "refresh", jti: "jti-old", sid: "s1", fid: "f1", at: "ADMIN" })
      .mockResolvedValueOnce({ sub: "u1", role: "admin", type: "refresh", exp: Math.floor(Date.now() / 1000) + 3600 });
    jwtService.signAsync.mockResolvedValueOnce("new-refresh-token").mockResolvedValueOnce("new-access-token");

    usersService.findRefreshTokenByJti.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      tokenJti: "jti-old",
      sessionId: "s1",
      familyId: "f1",
      actorType: "ADMIN",
      revokedAt: null,
      usedAt: null,
      revokedReason: null,
      replacedByTokenId: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    usersService.findById.mockResolvedValue({
      id: "u1",
      email: "admin@example.com",
      role: { name: "admin" },
      isActive: true
    });
    usersService.touchAuthSession.mockResolvedValue({ count: 1 });
    usersService.markAdminAccessSessionSeen.mockResolvedValue({ count: 1 });
    usersService.touchRefreshTokenFamily.mockResolvedValue({ count: 1 });
    usersService.storeRefreshToken.mockResolvedValue({ id: "rt2" });
    usersService.createRefreshTokenEvent.mockResolvedValue({});
    usersService.markRefreshTokenRotated.mockResolvedValue({});

    const result = await service.refresh("old-refresh-token", {
      actorTypeHint: AuthActorType.ADMIN,
      ipAddress: "127.0.0.1",
      userAgent: "jest"
    });

    expect(result).toEqual({
      accessToken: "new-access-token",
      refreshToken: "new-refresh-token"
    });
    expect(usersService.markRefreshTokenRotated).toHaveBeenCalledWith("rt1", "rt2", expect.any(Object));
  });

  it("detects reused refresh token and revokes family/session", async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: "u1",
      role: "admin",
      type: "refresh",
      jti: "jti-old",
      sid: "s1",
      fid: "f1",
      at: "ADMIN"
    });
    usersService.findRefreshTokenByJti.mockResolvedValue({
      id: "rt1",
      userId: "u1",
      tokenJti: "jti-old",
      sessionId: "s1",
      familyId: "f1",
      actorType: "ADMIN",
      revokedAt: new Date(),
      usedAt: null,
      revokedReason: "manual",
      replacedByTokenId: null,
      expiresAt: new Date(Date.now() + 60_000)
    });
    usersService.revokeRefreshTokenFamily.mockResolvedValue({ count: 3 });
    usersService.revokeAuthSession.mockResolvedValue({ count: 2 });
    usersService.createRefreshTokenEvent.mockResolvedValue({});
    usersService.createAuthRiskEvent.mockResolvedValue({});

    await expect(service.refresh("reused-token")).rejects.toThrow("Authentication failed");
    expect(usersService.revokeRefreshTokenFamily).toHaveBeenCalledWith("f1", "reuse_detected", expect.any(Object));
    expect(usersService.revokeAuthSession).toHaveBeenCalledWith("s1", "reuse_detected", expect.any(Object));
    expect(securityEventService.emitSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDomain: SecurityEventSourceDomain.AUTH,
        eventType: "refresh_token_reuse"
      }),
      expect.any(Object)
    );
  });

  it("blocks refresh when emergency control disables refresh globally", async () => {
    incidentReadinessService.isEmergencyControlActive.mockResolvedValue(true);
    jwtService.verifyAsync.mockResolvedValue({
      sub: "u1",
      role: "admin",
      type: "refresh",
      at: "ADMIN"
    });

    await expect(service.refresh("refresh-token")).rejects.toThrow("Authentication failed");
    expect(securityEventService.emitSecurityEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDomain: SecurityEventSourceDomain.AUTH,
        eventType: "refresh_blocked_by_emergency_control"
      })
    );
  });

  it("supports global logout by actor scope", async () => {
    jwtService.verifyAsync.mockResolvedValue({
      sub: "u1",
      role: "admin",
      type: "refresh",
      at: "ADMIN"
    });
    usersService.revokeAllAuthSessions.mockResolvedValue({ count: 4 });
    usersService.createAuthRiskEvent.mockResolvedValue({});

    const result = await service.logout("refresh-token", true);

    expect(result).toEqual({ revoked: 4 });
    expect(usersService.revokeAllAuthSessions).toHaveBeenCalledWith("u1", AuthActorType.ADMIN, "global_logout");
  });

  it("verifies admin step-up challenge", async () => {
    const passwordHash = await bcrypt.hash("pass123", 10);
    const codeHash = await bcrypt.hash("123456", 10);

    usersService.findAdminStepUpChallenge.mockResolvedValue({
      id: "ch1",
      userId: "u1",
      sessionId: "s1",
      status: "PENDING",
      challengeHash: codeHash,
      expiresAt: new Date(Date.now() + 60_000),
      failedAttempts: 0,
      maxAttempts: 3
    });
    usersService.findById.mockResolvedValue({
      id: "u1",
      email: "admin@example.com",
      passwordHash,
      role: { name: "admin" },
      isActive: true
    });
    usersService.updateAdminStepUpChallenge.mockResolvedValue({});
    usersService.createAuthRiskEvent.mockResolvedValue({});
    prismaService.adminAccessSession.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.verifyAdminStepUpChallenge("u1", {
      challengeId: "ch1",
      challengeCode: "123456",
      password: "pass123"
    });

    expect(result.verified).toBe(true);
    expect(usersService.updateAdminStepUpChallenge).toHaveBeenCalledWith(
      "ch1",
      expect.objectContaining({ status: "VERIFIED", verifiedAt: expect.any(Date) })
    );
  });
});
