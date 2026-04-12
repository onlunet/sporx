import { Injectable } from "@nestjs/common";
import { RefreshToken } from "@prisma/client";
import bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";

type RefreshTokenMatchState = "active" | "revoked" | "expired" | "missing";

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email }, include: { role: true } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, include: { role: true } });
  }

  async storeRefreshToken(userId: string, refreshToken: string, expiresAt: Date) {
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    return this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt
      }
    });
  }

  async validateRefreshToken(userId: string, refreshToken: string) {
    const match = await this.findRefreshTokenMatch(userId, refreshToken);
    return match.state === "active";
  }

  async findRefreshTokenMatch(
    userId: string,
    refreshToken: string
  ): Promise<{ state: RefreshTokenMatchState; token: RefreshToken | null }> {
    const tokens = await this.prisma.refreshToken.findMany({
      where: {
        userId
      },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    for (const token of tokens) {
      const ok = await bcrypt.compare(refreshToken, token.tokenHash);
      if (!ok) {
        continue;
      }

      if (token.revokedAt) {
        return { state: "revoked", token };
      }

      if (token.expiresAt.getTime() <= Date.now()) {
        return { state: "expired", token };
      }

      return { state: "active", token };
    }

    return { state: "missing", token: null };
  }

  async revokeRefreshTokenById(tokenId: string) {
    return this.prisma.refreshToken.updateMany({
      where: {
        id: tokenId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
  }

  async revokeAllActiveRefreshTokens(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date()
      }
    });
  }
}

