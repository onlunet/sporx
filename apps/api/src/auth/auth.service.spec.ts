import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const usersService = {
    findByEmail: jest.fn(),
    findById: jest.fn(),
    storeRefreshToken: jest.fn(),
    findRefreshTokenMatch: jest.fn(),
    revokeRefreshTokenById: jest.fn(),
    revokeAllActiveRefreshTokens: jest.fn()
  };

  const jwtService = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn()
  };

  const service = new AuthService(usersService as any, jwtService as any);

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_REFRESH_SECRET = "test-refresh-secret";
  });

  it("throws for unknown user", async () => {
    usersService.findByEmail.mockResolvedValue(null);
    await expect(service.login("x@y.com", "pwd")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rotates refresh token when active refresh request is valid", async () => {
    jwtService.verifyAsync
      .mockResolvedValueOnce({ sub: "u1", role: "admin", type: "refresh" })
      .mockResolvedValueOnce({ sub: "u1", role: "admin", type: "refresh", exp: Math.floor(Date.now() / 1000) + 3600 });
    jwtService.signAsync.mockResolvedValueOnce("new-access-token").mockResolvedValueOnce("new-refresh-token");
    usersService.findRefreshTokenMatch.mockResolvedValue({ state: "active", token: { id: "rt1" } });
    usersService.findById.mockResolvedValue({ id: "u1", email: "admin@example.com", role: { name: "admin" } });
    usersService.storeRefreshToken.mockResolvedValue({});
    usersService.revokeRefreshTokenById.mockResolvedValue({ count: 1 });

    const result = await service.refresh("old-refresh-token");

    expect(result.accessToken).toBe("new-access-token");
    expect(result.refreshToken).toBe("new-refresh-token");
    expect(usersService.revokeRefreshTokenById).toHaveBeenCalledWith("rt1");
    expect(usersService.storeRefreshToken).toHaveBeenCalledTimes(1);
  });

  it("revokes all sessions when revoked refresh token is reused", async () => {
    jwtService.verifyAsync.mockResolvedValue({ sub: "u1", role: "admin", type: "refresh" });
    usersService.findRefreshTokenMatch.mockResolvedValue({ state: "revoked", token: { id: "rt1" } });
    usersService.revokeAllActiveRefreshTokens.mockResolvedValue({ count: 2 });

    await expect(service.refresh("reused-token")).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.revokeAllActiveRefreshTokens).toHaveBeenCalledWith("u1");
  });
});

