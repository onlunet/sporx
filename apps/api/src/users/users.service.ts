import { Injectable } from "@nestjs/common";
import {
  AdminStepUpStatus,
  AuthActorType,
  AuthRiskSeverity,
  AuthRiskType,
  AuthSessionStatus,
  LoginAttemptResult,
  Prisma,
  RefreshToken,
  RefreshTokenEventType
} from "@prisma/client";
import bcrypt from "bcrypt";
import { PrismaService } from "../prisma/prisma.service";

type RefreshTokenMatchState = "active" | "revoked" | "expired" | "missing";

type DbClient = PrismaService | Prisma.TransactionClient;

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  private client(tx?: Prisma.TransactionClient): DbClient {
    return tx ?? this.prisma;
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email }, include: { role: true } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id }, include: { role: true } });
  }

  async storeRefreshToken(
    userId: string,
    refreshToken: string,
    expiresAt: Date,
    metadata?: {
      tokenJti?: string;
      familyId?: string | null;
      sessionId?: string | null;
      actorType?: AuthActorType;
      deviceFingerprint?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
    },
    tx?: Prisma.TransactionClient
  ) {
    const tokenHash = await bcrypt.hash(refreshToken, 10);
    return this.client(tx).refreshToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt,
        tokenJti: metadata?.tokenJti,
        familyId: metadata?.familyId ?? null,
        sessionId: metadata?.sessionId ?? null,
        actorType: metadata?.actorType ?? AuthActorType.PUBLIC,
        deviceFingerprint: metadata?.deviceFingerprint ?? null,
        ipAddress: metadata?.ipAddress ?? null,
        userAgent: metadata?.userAgent ?? null
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

      if (token.revokedAt || token.usedAt) {
        return { state: "revoked", token };
      }

      if (token.expiresAt.getTime() <= Date.now()) {
        return { state: "expired", token };
      }

      return { state: "active", token };
    }

    return { state: "missing", token: null };
  }

  findRefreshTokenByJti(userId: string, tokenJti: string) {
    return this.prisma.refreshToken.findFirst({
      where: {
        userId,
        tokenJti
      }
    });
  }

  findRefreshTokenById(tokenId: string) {
    return this.prisma.refreshToken.findUnique({
      where: { id: tokenId }
    });
  }

  async revokeRefreshTokenById(tokenId: string, reason = "manual", tx?: Prisma.TransactionClient) {
    return this.client(tx).refreshToken.updateMany({
      where: {
        id: tokenId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date(),
        revokedReason: reason
      }
    });
  }

  async revokeAllActiveRefreshTokens(userId: string, reason = "global_logout", tx?: Prisma.TransactionClient) {
    return this.client(tx).refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null
      },
      data: {
        revokedAt: new Date(),
        revokedReason: reason
      }
    });
  }

  async revokeRefreshTokenFamily(familyId: string, reason = "family_revoked", tx?: Prisma.TransactionClient) {
    const now = new Date();
    const db = this.client(tx);
    await db.refreshTokenFamily.updateMany({
      where: { id: familyId, status: AuthSessionStatus.ACTIVE },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        revokedReason: reason
      }
    });
    return db.refreshToken.updateMany({
      where: {
        familyId,
        revokedAt: null
      },
      data: {
        revokedAt: now,
        revokedReason: reason
      }
    });
  }

  createAuthSession(
    input: {
      userId: string;
      actorType: AuthActorType;
      sessionKey: string;
      expiresAt: Date;
      ipAddress?: string | null;
      userAgent?: string | null;
      deviceFingerprint?: string | null;
      environment?: string | null;
    },
    tx?: Prisma.TransactionClient
  ) {
    return this.client(tx).authSession.create({
      data: {
        userId: input.userId,
        actorType: input.actorType,
        sessionKey: input.sessionKey,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        deviceFingerprint: input.deviceFingerprint ?? null,
        environment: input.environment ?? null
      }
    });
  }

  touchAuthSession(sessionId: string, tx?: Prisma.TransactionClient) {
    return this.client(tx).authSession.updateMany({
      where: {
        id: sessionId,
        status: AuthSessionStatus.ACTIVE
      },
      data: {
        lastSeenAt: new Date()
      }
    });
  }

  async revokeAuthSession(sessionId: string, reason: string, tx?: Prisma.TransactionClient) {
    const now = new Date();
    const db = this.client(tx);
    await db.authSession.updateMany({
      where: { id: sessionId, status: AuthSessionStatus.ACTIVE },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        revokedReason: reason
      }
    });

    await db.adminAccessSession.updateMany({
      where: { sessionId, status: AuthSessionStatus.ACTIVE },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        reason
      }
    });

    await db.refreshTokenFamily.updateMany({
      where: { sessionId, status: AuthSessionStatus.ACTIVE },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        revokedReason: reason
      }
    });

    return db.refreshToken.updateMany({
      where: {
        sessionId,
        revokedAt: null
      },
      data: {
        revokedAt: now,
        revokedReason: reason
      }
    });
  }

  async revokeAllAuthSessions(userId: string, actorType?: AuthActorType, reason = "global_logout", tx?: Prisma.TransactionClient) {
    const now = new Date();
    const db = this.client(tx);

    const where: Prisma.AuthSessionWhereInput = {
      userId,
      status: AuthSessionStatus.ACTIVE,
      ...(actorType ? { actorType } : {})
    };

    await db.authSession.updateMany({
      where,
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        revokedReason: reason
      }
    });

    await db.adminAccessSession.updateMany({
      where: {
        userId,
        status: AuthSessionStatus.ACTIVE
      },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        reason
      }
    });

    await db.refreshTokenFamily.updateMany({
      where: {
        userId,
        status: AuthSessionStatus.ACTIVE,
        ...(actorType ? { actorType } : {})
      },
      data: {
        status: AuthSessionStatus.REVOKED,
        revokedAt: now,
        revokedReason: reason
      }
    });

    return db.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(actorType ? { actorType } : {})
      },
      data: {
        revokedAt: now,
        revokedReason: reason
      }
    });
  }

  createRefreshTokenFamily(
    input: {
      userId: string;
      sessionId: string;
      actorType: AuthActorType;
      expiresAt: Date;
    },
    tx?: Prisma.TransactionClient
  ) {
    return this.client(tx).refreshTokenFamily.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId,
        actorType: input.actorType,
        expiresAt: input.expiresAt
      }
    });
  }

  touchRefreshTokenFamily(familyId: string, tx?: Prisma.TransactionClient) {
    return this.client(tx).refreshTokenFamily.updateMany({
      where: { id: familyId, status: AuthSessionStatus.ACTIVE },
      data: {
        lastRotatedAt: new Date()
      }
    });
  }

  createRefreshTokenEvent(
    input: {
      userId?: string | null;
      familyId?: string | null;
      tokenId?: string | null;
      eventType: RefreshTokenEventType;
      reason?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      metadata?: Prisma.InputJsonValue | null;
    },
    tx?: Prisma.TransactionClient
  ) {
    return this.client(tx).refreshTokenEvent.create({
      data: {
        userId: input.userId ?? null,
        familyId: input.familyId ?? null,
        tokenId: input.tokenId ?? null,
        eventType: input.eventType,
        reason: input.reason ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? undefined
      }
    });
  }

  createLoginAttempt(
    input: {
      userId?: string | null;
      actorType: AuthActorType;
      email?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      result: LoginAttemptResult;
      reason?: string | null;
      riskScore?: number;
      lockedUntil?: Date | null;
    },
    tx?: Prisma.TransactionClient
  ) {
    return this.client(tx).loginAttempt.create({
      data: {
        userId: input.userId ?? null,
        actorType: input.actorType,
        email: input.email ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        result: input.result,
        reason: input.reason ?? null,
        riskScore: input.riskScore ?? 0,
        lockedUntil: input.lockedUntil ?? null
      }
    });
  }

  async getRecentLoginFailures(
    actorType: AuthActorType,
    email: string,
    ipAddress: string,
    since: Date
  ) {
    return this.prisma.loginAttempt.findMany({
      where: {
        actorType,
        createdAt: { gte: since },
        result: { in: [LoginAttemptResult.FAILURE, LoginAttemptResult.LOCKED] },
        OR: [{ email }, { ipAddress }]
      },
      orderBy: {
        createdAt: "desc"
      },
      take: 200
    });
  }

  createAuthRiskEvent(
    input: {
      userId?: string | null;
      sessionId?: string | null;
      familyId?: string | null;
      actorType: AuthActorType;
      riskType: AuthRiskType;
      severity: AuthRiskSeverity;
      reason?: string | null;
      ipAddress?: string | null;
      userAgent?: string | null;
      metadata?: Prisma.InputJsonValue | null;
    },
    tx?: Prisma.TransactionClient
  ) {
    return this.client(tx).authRiskEvent.create({
      data: {
        userId: input.userId ?? null,
        sessionId: input.sessionId ?? null,
        familyId: input.familyId ?? null,
        actorType: input.actorType,
        riskType: input.riskType,
        severity: input.severity,
        reason: input.reason ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        metadata: input.metadata ?? undefined
      }
    });
  }

  createAdminAccessSession(
    input: {
      userId: string;
      sessionId: string;
      status?: AuthSessionStatus;
      stepUpRequired?: boolean;
      ipAddress?: string | null;
      userAgent?: string | null;
      allowedIp?: boolean | null;
      reason?: string | null;
    },
    tx?: Prisma.TransactionClient
  ) {
    return this.client(tx).adminAccessSession.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId,
        status: input.status ?? AuthSessionStatus.ACTIVE,
        stepUpRequired: input.stepUpRequired ?? false,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        allowedIp: input.allowedIp ?? null,
        reason: input.reason ?? null
      }
    });
  }

  markAdminAccessSessionSeen(sessionId: string, tx?: Prisma.TransactionClient) {
    return this.client(tx).adminAccessSession.updateMany({
      where: {
        sessionId,
        status: AuthSessionStatus.ACTIVE
      },
      data: {
        lastSeenAt: new Date()
      }
    });
  }

  createAdminStepUpChallenge(
    input: {
      userId: string;
      sessionId?: string | null;
      challengeHash: string;
      expiresAt: Date;
      ipAddress?: string | null;
      userAgent?: string | null;
      reason?: string | null;
      maxAttempts?: number;
    },
    tx?: Prisma.TransactionClient
  ) {
    return this.client(tx).adminStepUpChallenge.create({
      data: {
        userId: input.userId,
        sessionId: input.sessionId ?? null,
        challengeHash: input.challengeHash,
        expiresAt: input.expiresAt,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
        reason: input.reason ?? null,
        maxAttempts: input.maxAttempts ?? 3
      }
    });
  }

  findAdminStepUpChallenge(challengeId: string, userId: string) {
    return this.prisma.adminStepUpChallenge.findFirst({
      where: {
        id: challengeId,
        userId
      }
    });
  }

  updateAdminStepUpChallenge(
    challengeId: string,
    data: {
      status?: AdminStepUpStatus;
      verifiedAt?: Date | null;
      failedAttempts?: number;
    },
    tx?: Prisma.TransactionClient
  ) {
    return this.client(tx).adminStepUpChallenge.update({
      where: { id: challengeId },
      data: {
        ...(data.status ? { status: data.status } : {}),
        ...(data.verifiedAt !== undefined ? { verifiedAt: data.verifiedAt } : {}),
        ...(data.failedAttempts !== undefined ? { failedAttempts: data.failedAttempts } : {})
      }
    });
  }

  findAuthSessions(input: { userId?: string; includeRevoked?: boolean; limit?: number }) {
    return this.prisma.authSession.findMany({
      where: {
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.includeRevoked ? {} : { status: AuthSessionStatus.ACTIVE })
      },
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(input.limit ?? 50, 1), 200),
      include: {
        user: { select: { id: true, email: true, role: { select: { name: true } } } },
        adminAccessSession: true
      }
    });
  }

  findLoginAttempts(limit = 100) {
    return this.prisma.loginAttempt.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500)
    });
  }

  findAuthRiskEvents(limit = 100) {
    return this.prisma.authRiskEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500)
    });
  }

  findRefreshTokenEvents(limit = 100) {
    return this.prisma.refreshTokenEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.min(Math.max(limit, 1), 500)
    });
  }

  async markRefreshTokenRotated(oldTokenId: string, replacementTokenId: string, tx?: Prisma.TransactionClient) {
    return this.client(tx).refreshToken.update({
      where: { id: oldTokenId },
      data: {
        usedAt: new Date(),
        revokedAt: new Date(),
        revokedReason: "rotated",
        replacedByTokenId: replacementTokenId
      }
    });
  }
}
