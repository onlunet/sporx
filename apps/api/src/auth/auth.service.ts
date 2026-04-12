import { Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcrypt";
import { UsersService } from "../users/users.service";

type RefreshPayload = {
  sub: string;
  role: string;
  type: "refresh";
  exp?: number;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService
  ) {}

  private getRefreshSecret() {
    const secret = process.env.JWT_REFRESH_SECRET ?? "change_me_refresh";
    if (!process.env.JWT_REFRESH_SECRET && process.env.NODE_ENV === "production") {
      throw new Error("JWT_REFRESH_SECRET is required");
    }
    return secret;
  }

  private async signAccessToken(user: { id: string; email: string; role: { name: string } }) {
    return this.jwtService.signAsync({ sub: user.id, role: user.role.name, email: user.email });
  }

  private async signRefreshToken(user: { id: string; role: { name: string } }) {
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, role: user.role.name, type: "refresh" },
      {
        secret: this.getRefreshSecret(),
        expiresIn: (process.env.JWT_REFRESH_TTL ?? "30d") as any
      }
    );

    const payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
      secret: this.getRefreshSecret()
    });

    const expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return { refreshToken, expiresAt };
  }

  private async issueTokenPair(user: { id: string; email: string; role: { name: string } }) {
    const accessToken = await this.signAccessToken(user);
    const { refreshToken, expiresAt } = await this.signRefreshToken(user);

    await this.usersService.storeRefreshToken(user.id, refreshToken, expiresAt);
    return { accessToken, refreshToken };
  }

  async login(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException("Invalid credentials");
    }

    const { accessToken, refreshToken } = await this.issueTokenPair(user);

    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role.name
      }
    };
  }

  async refresh(refreshToken: string) {
    let payload: RefreshPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.getRefreshSecret()
      });
    } catch {
      throw new UnauthorizedException("Invalid refresh token");
    }

    if (payload.type !== "refresh") {
      throw new UnauthorizedException("Invalid refresh token type");
    }

    const match = await this.usersService.findRefreshTokenMatch(payload.sub, refreshToken);
    if (match.state === "revoked") {
      await this.usersService.revokeAllActiveRefreshTokens(payload.sub);
      throw new UnauthorizedException("Refresh token reuse detected. Session revoked.");
    }

    if (match.state !== "active" || !match.token) {
      throw new UnauthorizedException("Invalid refresh token");
    }

    await this.usersService.revokeRefreshTokenById(match.token.id);

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new UnauthorizedException("User not found");
    }

    const { accessToken, refreshToken: rotatedRefreshToken } = await this.issueTokenPair(user);
    return {
      accessToken,
      refreshToken: rotatedRefreshToken
    };
  }

  async logout(refreshToken: string, allSessions = false) {
    let payload: RefreshPayload;

    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.getRefreshSecret(),
        ignoreExpiration: true
      });
    } catch {
      return { revoked: 0 };
    }

    if (payload.type !== "refresh") {
      return { revoked: 0 };
    }

    if (allSessions) {
      const result = await this.usersService.revokeAllActiveRefreshTokens(payload.sub);
      return { revoked: result.count };
    }

    const match = await this.usersService.findRefreshTokenMatch(payload.sub, refreshToken);
    if (!match.token || match.state === "missing") {
      return { revoked: 0 };
    }

    const result = await this.usersService.revokeRefreshTokenById(match.token.id);
    return { revoked: result.count };
  }
}
