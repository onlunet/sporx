import { Injectable, UnauthorizedException } from "@nestjs/common";
import {
  AccessActorType,
  AdminStepUpStatus,
  AuthActorType,
  AuthRiskSeverity,
  AuthRiskType,
  AuthSessionStatus,
  LoginAttemptResult,
  RefreshToken,
  RefreshTokenEventType,
  SecurityEventSeverity,
  SecurityEventSourceDomain
} from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import bcrypt from "bcrypt";
import { randomBytes, randomInt, randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import { IncidentReadinessService } from "../modules/security-events/incident-readiness.service";
import { SecurityEventService } from "../modules/security-events/security-event.service";

type RefreshPayload = {
  sub: string;
  role: string;
  type: "refresh";
  jti?: string;
  sid?: string;
  fid?: string;
  at?: AuthActorType;
  exp?: number;
};

type AuthRequestContext = {
  ipAddress?: string;
  userAgent?: string;
  environment?: string;
  deviceFingerprint?: string;
  actorTypeHint?: AuthActorType;
};

const ADMIN_ROLES = new Set(["super_admin", "admin", "analyst", "viewer"]);

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function parseInteger(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function parseDurationToMs(raw: string | undefined, fallbackMs: number) {
  if (!raw) {
    return fallbackMs;
  }
  const input = raw.trim().toLowerCase();
  if (!input) {
    return fallbackMs;
  }

  const match = /^(\d+)([smhd])?$/.exec(input);
  if (!match) {
    return fallbackMs;
  }

  const amount = Number.parseInt(match[1], 10);
  const unit = match[2] ?? "s";
  if (!Number.isFinite(amount) || amount <= 0) {
    return fallbackMs;
  }

  const multiplier =
    unit === "d"
      ? 24 * 60 * 60 * 1000
      : unit === "h"
        ? 60 * 60 * 1000
        : unit === "m"
          ? 60 * 1000
          : 1000;

  return amount * multiplier;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService,
    private readonly incidentReadinessService: IncidentReadinessService
  ) {}

  private mapActorTypeForSecurity(actorType: AuthActorType) {
    return actorType === AuthActorType.ADMIN ? AccessActorType.ADMIN : AccessActorType.USER;
  }

  private throwAuthFailed(): never {
    throw new UnauthorizedException("Authentication failed");
  }

  private normalizeEmail(value: string) {
    return value.trim().toLowerCase();
  }

  private getAccessTtl(actorType: AuthActorType) {
    if (actorType === AuthActorType.ADMIN) {
      return (process.env.JWT_ACCESS_TTL_ADMIN ?? process.env.JWT_ACCESS_TTL ?? "10m") as any;
    }
    return (process.env.JWT_ACCESS_TTL ?? "15m") as any;
  }

  private getRefreshTtl(actorType: AuthActorType) {
    if (actorType === AuthActorType.ADMIN) {
      return (process.env.JWT_REFRESH_TTL_ADMIN ?? process.env.JWT_REFRESH_TTL ?? "7d") as any;
    }
    return (process.env.JWT_REFRESH_TTL ?? "30d") as any;
  }

  private getRefreshTtlMs(actorType: AuthActorType) {
    const fallback = actorType === AuthActorType.ADMIN ? 7 * 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000;
    return parseDurationToMs(this.getRefreshTtl(actorType), fallback);
  }

  private getRefreshSecret(actorType: AuthActorType) {
    const key =
      actorType === AuthActorType.ADMIN
        ? process.env.JWT_REFRESH_SECRET_ADMIN ?? process.env.JWT_REFRESH_SECRET
        : process.env.JWT_REFRESH_SECRET ?? process.env.JWT_REFRESH_SECRET_ADMIN;
    const secret = key ?? "change_me_refresh";
    if (!key && process.env.NODE_ENV === "production") {
      throw new Error("JWT_REFRESH_SECRET is required");
    }
    return secret;
  }

  private getRefreshSecretsForVerify() {
    const admin = this.getRefreshSecret(AuthActorType.ADMIN);
    const publicSecret = this.getRefreshSecret(AuthActorType.PUBLIC);
    if (admin === publicSecret) {
      return [{ actorType: AuthActorType.PUBLIC, secret: publicSecret }];
    }
    return [
      { actorType: AuthActorType.ADMIN, secret: admin },
      { actorType: AuthActorType.PUBLIC, secret: publicSecret }
    ];
  }

  private resolveActorType(roleName: string | undefined, hint?: AuthActorType) {
    if (roleName && ADMIN_ROLES.has(roleName)) {
      return AuthActorType.ADMIN;
    }
    if (hint === AuthActorType.ADMIN) {
      return AuthActorType.ADMIN;
    }
    return AuthActorType.PUBLIC;
  }

  private isAdminIpRestrictionEnabled() {
    return parseBoolean(process.env.ADMIN_IP_RESTRICTION_ENABLED, false);
  }

  private isStrictAdminAuthEnabled() {
    return parseBoolean(process.env.STRICT_ADMIN_AUTH_ENABLED, true);
  }

  private isAuthLockoutEnabled() {
    return parseBoolean(process.env.AUTH_LOCKOUT_ENABLED, true);
  }

  private isRefreshReuseDetectionEnabled() {
    return parseBoolean(process.env.REFRESH_REUSE_DETECTION_ENABLED, true);
  }

  private readThreshold(actorType: AuthActorType, publicKey: string, adminKey: string, fallbackPublic: number, fallbackAdmin: number) {
    if (actorType === AuthActorType.ADMIN) {
      return parseInteger(process.env[adminKey], fallbackAdmin);
    }
    return parseInteger(process.env[publicKey], fallbackPublic);
  }

  private getLockWindowMinutes(actorType: AuthActorType) {
    return this.readThreshold(actorType, "AUTH_LOGIN_FAIL_WINDOW_MINUTES_PUBLIC", "AUTH_LOGIN_FAIL_WINDOW_MINUTES_ADMIN", 15, 30);
  }

  private getLockThreshold(actorType: AuthActorType) {
    return this.readThreshold(actorType, "AUTH_LOGIN_FAIL_THRESHOLD_PUBLIC", "AUTH_LOGIN_FAIL_THRESHOLD_ADMIN", 10, 5);
  }

  private getLockMinutes(actorType: AuthActorType) {
    return this.readThreshold(actorType, "AUTH_LOGIN_LOCK_MINUTES_PUBLIC", "AUTH_LOGIN_LOCK_MINUTES_ADMIN", 10, 30);
  }

  private getRefreshRetryGraceSeconds() {
    return parseInteger(process.env.AUTH_REFRESH_RETRY_GRACE_SECONDS, 20);
  }

  private isFailureAttemptRelevant(
    attempt: { email?: string | null; ipAddress?: string | null },
    email: string,
    ipAddress: string
  ) {
    const attemptEmail = typeof attempt.email === "string" ? attempt.email.trim().toLowerCase() : "";
    if (attemptEmail.length > 0) {
      return attemptEmail === email;
    }
    return Boolean(ipAddress) && attempt.ipAddress === ipAddress;
  }

  private filterRelevantLoginFailures<T extends { email?: string | null; ipAddress?: string | null }>(
    attempts: T[],
    email: string,
    ipAddress: string
  ) {
    return attempts.filter((attempt) => this.isFailureAttemptRelevant(attempt, email, ipAddress));
  }

  private isAdminIpAllowed(ipAddress: string) {
    const raw = (process.env.ADMIN_IP_ALLOWLIST ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    if (raw.length === 0) {
      return true;
    }

    return raw.some((rule) => {
      if (rule === ipAddress) {
        return true;
      }
      if (rule.endsWith("*")) {
        const prefix = rule.slice(0, -1);
        return ipAddress.startsWith(prefix);
      }
      return false;
    });
  }

  private async signAccessToken(
    user: { id: string; email: string; role: { name: string } },
    sessionId: string,
    actorType: AuthActorType
  ) {
    return this.jwtService.signAsync(
      {
        sub: user.id,
        role: user.role.name,
        email: user.email,
        sid: sessionId,
        at: actorType
      },
      {
        expiresIn: this.getAccessTtl(actorType)
      }
    );
  }

  private async signRefreshToken(
    user: { id: string; role: { name: string } },
    actorType: AuthActorType,
    sessionId: string,
    familyId: string
  ) {
    const tokenJti = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        role: user.role.name,
        type: "refresh",
        jti: tokenJti,
        sid: sessionId,
        fid: familyId,
        at: actorType
      },
      {
        secret: this.getRefreshSecret(actorType),
        expiresIn: this.getRefreshTtl(actorType)
      }
    );

    const payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
      secret: this.getRefreshSecret(actorType)
    });

    const expiresAt = payload.exp
      ? new Date(payload.exp * 1000)
      : new Date(Date.now() + this.getRefreshTtlMs(actorType));
    return { refreshToken, expiresAt, tokenJti };
  }

  private async verifyRefreshToken(
    token: string,
    options?: { ignoreExpiration?: boolean }
  ): Promise<{ payload: RefreshPayload; actorType: AuthActorType }> {
    for (const candidate of this.getRefreshSecretsForVerify()) {
      try {
        const payload = await this.jwtService.verifyAsync<RefreshPayload>(token, {
          secret: candidate.secret,
          ignoreExpiration: options?.ignoreExpiration ?? false
        });
        const actorType =
          payload.at === AuthActorType.ADMIN || payload.at === AuthActorType.PUBLIC
            ? payload.at
            : candidate.actorType;
        return { payload, actorType };
      } catch {
        // try next secret
      }
    }
    this.throwAuthFailed();
  }

  private async ensureLoginNotLocked(input: {
    actorType: AuthActorType;
    email: string;
    ipAddress: string;
    userAgent?: string;
    userId?: string;
  }) {
    if (!this.isAuthLockoutEnabled()) {
      return;
    }

    const since = new Date(Date.now() - this.getLockWindowMinutes(input.actorType) * 60 * 1000);
    const attempts = await this.usersService.getRecentLoginFailures(input.actorType, input.email, input.ipAddress, since);
    const relevantAttempts = this.filterRelevantLoginFailures(attempts, input.email, input.ipAddress);
    const nowMs = Date.now();
    const activeLockUntil = relevantAttempts
      .map((item) => item.lockedUntil?.getTime() ?? 0)
      .filter((value) => value > nowMs)
      .sort((a, b) => b - a)[0];

    if (!activeLockUntil) {
      return;
    }

    await this.usersService.createLoginAttempt({
      userId: input.userId,
      actorType: input.actorType,
      email: input.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      result: LoginAttemptResult.LOCKED,
      reason: "active_lockout",
      lockedUntil: new Date(activeLockUntil)
    });

    this.throwAuthFailed();
  }

  private async registerFailedLogin(input: {
    userId?: string;
    actorType: AuthActorType;
    email: string;
    ipAddress: string;
    userAgent?: string;
    reason: string;
  }) {
    await this.usersService.createLoginAttempt({
      userId: input.userId,
      actorType: input.actorType,
      email: input.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      result: LoginAttemptResult.FAILURE,
      reason: input.reason
    });

    await this.securityEventService.emitSecurityEvent({
      sourceDomain: SecurityEventSourceDomain.AUTH,
      eventType: input.actorType === AuthActorType.ADMIN ? "admin_login_failure" : "login_failure",
      severity: input.actorType === AuthActorType.ADMIN ? SecurityEventSeverity.HIGH : SecurityEventSeverity.MEDIUM,
      actorType: this.mapActorTypeForSecurity(input.actorType),
      actorId: input.userId ?? null,
      targetResourceType: "auth",
      reason: input.reason,
      context: {
        ipAddress: input.ipAddress,
        userAgent: input.userAgent ?? null
      },
      metadata: {
        email: input.email
      }
    });

    if (!this.isAuthLockoutEnabled()) {
      return;
    }

    const since = new Date(Date.now() - this.getLockWindowMinutes(input.actorType) * 60 * 1000);
    const failures = await this.usersService.getRecentLoginFailures(input.actorType, input.email, input.ipAddress, since);
    const relevantFailures = this.filterRelevantLoginFailures(failures, input.email, input.ipAddress);
    const threshold = this.getLockThreshold(input.actorType);
    if (relevantFailures.length < threshold) {
      return;
    }

    const lockedUntil = new Date(Date.now() + this.getLockMinutes(input.actorType) * 60 * 1000);
    await this.usersService.createLoginAttempt({
      userId: input.userId,
      actorType: input.actorType,
      email: input.email,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      result: LoginAttemptResult.LOCKED,
      reason: "threshold_reached",
      lockedUntil,
      riskScore: 100
    });

    await this.usersService.createAuthRiskEvent({
      userId: input.userId,
      actorType: input.actorType,
      riskType: AuthRiskType.BRUTE_FORCE,
      severity: AuthRiskSeverity.HIGH,
      reason: "login_threshold_reached",
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
          metadata: {
            failures: relevantFailures.length,
            threshold,
            lockedUntil: lockedUntil.toISOString()
          }
    });
  }

  private async issueTokenPair(
    user: { id: string; email: string; role: { name: string } },
    actorType: AuthActorType,
    context?: AuthRequestContext,
    existing?: {
      refreshTokenId?: string;
      sessionId?: string | null;
      familyId?: string | null;
    }
  ) {
    return this.prisma.$transaction(async (tx) => {
      let sessionId = existing?.sessionId ?? null;
      if (!sessionId) {
        const session = await this.usersService.createAuthSession(
          {
            userId: user.id,
            actorType,
            sessionKey: randomUUID(),
            expiresAt: new Date(Date.now() + this.getRefreshTtlMs(actorType)),
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent,
            deviceFingerprint: context?.deviceFingerprint,
            environment: context?.environment
          },
          tx
        );
        sessionId = session.id;

        if (actorType === AuthActorType.ADMIN) {
          await this.usersService.createAdminAccessSession(
            {
              userId: user.id,
              sessionId,
              stepUpRequired: parseBoolean(process.env.ADMIN_STEP_UP_AUTH_ENABLED, false),
              allowedIp: this.isAdminIpRestrictionEnabled() ? this.isAdminIpAllowed(context?.ipAddress ?? "unknown") : null,
              ipAddress: context?.ipAddress,
              userAgent: context?.userAgent
            },
            tx
          );
        }
      } else {
        await this.usersService.touchAuthSession(sessionId, tx);
        if (actorType === AuthActorType.ADMIN) {
          await this.usersService.markAdminAccessSessionSeen(sessionId, tx);
        }
      }

      let familyId = existing?.familyId ?? null;
      if (!familyId) {
        const family = await this.usersService.createRefreshTokenFamily(
          {
            userId: user.id,
            sessionId,
            actorType,
            expiresAt: new Date(Date.now() + this.getRefreshTtlMs(actorType))
          },
          tx
        );
        familyId = family.id;
      } else {
        await this.usersService.touchRefreshTokenFamily(familyId, tx);
      }

      const { refreshToken, expiresAt, tokenJti } = await this.signRefreshToken(user, actorType, sessionId, familyId);
      const storedRefreshToken = await this.usersService.storeRefreshToken(
        user.id,
        refreshToken,
        expiresAt,
        {
          tokenJti,
          familyId,
          sessionId,
          actorType,
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          deviceFingerprint: context?.deviceFingerprint
        },
        tx
      );

      await this.usersService.createRefreshTokenEvent(
        {
          userId: user.id,
          familyId,
          tokenId: storedRefreshToken.id,
          eventType: RefreshTokenEventType.ISSUED,
          reason: existing?.refreshTokenId ? "refresh_rotation" : "login",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent
        },
        tx
      );

      if (existing?.refreshTokenId) {
        await this.usersService.markRefreshTokenRotated(existing.refreshTokenId, storedRefreshToken.id, tx);
        await this.usersService.createRefreshTokenEvent(
          {
            userId: user.id,
            familyId,
            tokenId: existing.refreshTokenId,
            eventType: RefreshTokenEventType.ROTATED,
            reason: "refresh_rotation",
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent
          },
          tx
        );
      }

      const accessToken = await this.signAccessToken(user, sessionId, actorType);
      return {
        accessToken,
        refreshToken,
        actorType,
        sessionId
      };
    });
  }

  private async resolveStoredRefreshToken(userId: string, refreshToken: string, payload: RefreshPayload) {
    if (payload.jti) {
      const byJti = await this.usersService.findRefreshTokenByJti(userId, payload.jti);
      if (byJti) {
        if (byJti.revokedAt || byJti.usedAt) {
          return { state: "revoked" as const, token: byJti };
        }
        if (byJti.expiresAt.getTime() <= Date.now()) {
          return { state: "expired" as const, token: byJti };
        }
        return { state: "active" as const, token: byJti };
      }
    }

    return this.usersService.findRefreshTokenMatch(userId, refreshToken);
  }

  private async processReuseDetection(token: RefreshToken, actorType: AuthActorType, context?: AuthRequestContext) {
    if (!this.isRefreshReuseDetectionEnabled()) {
      return;
    }

    await this.prisma.$transaction(async (tx) => {
      if (token.familyId) {
        await this.usersService.revokeRefreshTokenFamily(token.familyId, "reuse_detected", tx);
        await this.usersService.createRefreshTokenEvent(
          {
            userId: token.userId,
            familyId: token.familyId,
            tokenId: token.id,
            eventType: RefreshTokenEventType.FAMILY_REVOKED,
            reason: "reuse_detected",
            ipAddress: context?.ipAddress,
            userAgent: context?.userAgent
          },
          tx
        );
      } else {
        await this.usersService.revokeAllActiveRefreshTokens(token.userId, "reuse_detected", tx);
      }

      if (token.sessionId) {
        await this.usersService.revokeAuthSession(token.sessionId, "reuse_detected", tx);
      }

      await this.usersService.createRefreshTokenEvent(
        {
          userId: token.userId,
          familyId: token.familyId,
          tokenId: token.id,
          eventType: RefreshTokenEventType.REUSE_DETECTED,
          reason: "refresh_token_reuse",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent
        },
        tx
      );

      await this.usersService.createAuthRiskEvent(
        {
          userId: token.userId,
          sessionId: token.sessionId,
          familyId: token.familyId,
          actorType,
          riskType: AuthRiskType.TOKEN_REUSE,
          severity: AuthRiskSeverity.CRITICAL,
          reason: "refresh_token_reuse_detected",
          ipAddress: context?.ipAddress,
          userAgent: context?.userAgent,
          metadata: {
            tokenId: token.id
          }
        },
        tx
      );

      await this.securityEventService.emitSecurityEvent(
        {
          eventKey: `auth:refresh_reuse:${token.id}:${token.usedAt?.getTime() ?? token.revokedAt?.getTime() ?? Date.now()}`,
          sourceDomain: SecurityEventSourceDomain.AUTH,
          eventType: "refresh_token_reuse",
          severity: SecurityEventSeverity.CRITICAL,
          actorType: this.mapActorTypeForSecurity(actorType),
          actorId: token.userId,
          targetResourceType: "refresh_token",
          targetResourceId: token.id,
          reason: "refresh_token_reuse_detected",
          context: {
            ipAddress: context?.ipAddress ?? null,
            userAgent: context?.userAgent ?? null,
            environment: context?.environment ?? null
          },
          metadata: {
            sessionId: token.sessionId,
            familyId: token.familyId
          }
        },
        tx
      );
    });
  }

  async login(email: string, password: string, context?: AuthRequestContext) {
    const normalizedEmail = this.normalizeEmail(email);
    const user = await this.usersService.findByEmail(normalizedEmail);
    const actorType = this.resolveActorType(user?.role?.name, context?.actorTypeHint);
    const ipAddress = context?.ipAddress ?? "unknown";
    const userAgent = context?.userAgent;

    await this.ensureLoginNotLocked({
      actorType,
      email: normalizedEmail,
      ipAddress,
      userAgent,
      userId: user?.id
    });

    if (!user || !user.isActive) {
      await this.registerFailedLogin({
        userId: user?.id,
        actorType,
        email: normalizedEmail,
        ipAddress,
        userAgent,
        reason: "invalid_credentials"
      });
      this.throwAuthFailed();
    }
    const activeUser = user;

    if (actorType === AuthActorType.ADMIN && this.isStrictAdminAuthEnabled() && this.isAdminIpRestrictionEnabled()) {
      const allowed = this.isAdminIpAllowed(ipAddress);
      if (!allowed) {
        await this.registerFailedLogin({
          userId: activeUser.id,
          actorType,
          email: normalizedEmail,
          ipAddress,
          userAgent,
          reason: "admin_ip_not_allowed"
        });
        await this.usersService.createAuthRiskEvent({
          userId: activeUser.id,
          actorType,
          riskType: AuthRiskType.ADMIN_IP_BLOCKED,
          severity: AuthRiskSeverity.HIGH,
          reason: "admin_ip_restriction_blocked_login",
          ipAddress,
          userAgent
        });
        this.throwAuthFailed();
      }
    }

    const ok = await bcrypt.compare(password, activeUser.passwordHash);
    if (!ok) {
      await this.registerFailedLogin({
        userId: activeUser.id,
        actorType,
        email: normalizedEmail,
        ipAddress,
        userAgent,
        reason: "invalid_credentials"
      });
      this.throwAuthFailed();
    }

    await this.usersService.createLoginAttempt({
      userId: activeUser.id,
      actorType,
      email: normalizedEmail,
      ipAddress,
      userAgent,
      result: LoginAttemptResult.SUCCESS,
      reason: "login_success"
    });

    await this.securityEventService.emitSecurityEvent({
      sourceDomain: SecurityEventSourceDomain.AUTH,
      eventType: actorType === AuthActorType.ADMIN ? "admin_login_success" : "login_success",
      severity: SecurityEventSeverity.INFO,
      actorType: this.mapActorTypeForSecurity(actorType),
      actorId: activeUser.id,
      targetResourceType: "auth",
      reason: "login_success",
      context: {
        ipAddress,
        userAgent: userAgent ?? null,
        environment: context?.environment ?? null
      },
      metadata: {
        email: activeUser.email
      }
    });

    const { accessToken, refreshToken, sessionId } = await this.issueTokenPair(activeUser, actorType, context);

    return {
      accessToken,
      refreshToken,
      user: {
        id: activeUser.id,
        email: activeUser.email,
        role: activeUser.role.name
      },
      sessionId
    };
  }

  async refresh(refreshToken: string, context?: AuthRequestContext) {
    const verified = await this.verifyRefreshToken(refreshToken);
    const payload = verified.payload;
    const actorType = payload.at ?? verified.actorType ?? AuthActorType.PUBLIC;
    const ipAddress = context?.ipAddress ?? "unknown";
    const userAgent = context?.userAgent;

    if (await this.incidentReadinessService.isEmergencyControlActive("disable_refresh_global")) {
      await this.securityEventService.emitSecurityEvent({
        sourceDomain: SecurityEventSourceDomain.AUTH,
        eventType: "refresh_blocked_by_emergency_control",
        severity: SecurityEventSeverity.CRITICAL,
        actorType: this.mapActorTypeForSecurity(actorType),
        actorId: payload.sub ?? null,
        targetResourceType: "auth_refresh",
        reason: "disable_refresh_global",
        context: {
          ipAddress,
          userAgent: userAgent ?? null,
          environment: context?.environment ?? null
        }
      });
      this.throwAuthFailed();
    }

    if (payload.type !== "refresh" || !payload.sub) {
      this.throwAuthFailed();
    }

    const match = await this.resolveStoredRefreshToken(payload.sub, refreshToken, payload);
    if (!match.token || match.state === "missing" || match.state === "expired") {
      this.throwAuthFailed();
    }

    const storedToken = match.token;
    if (storedToken.revokedAt || storedToken.usedAt || match.state === "revoked") {
      const graceSeconds = this.getRefreshRetryGraceSeconds();
      const rotatedAtMs = storedToken.usedAt?.getTime() ?? storedToken.revokedAt?.getTime() ?? 0;
      const inGracePeriod = rotatedAtMs > 0 && Date.now() - rotatedAtMs <= graceSeconds * 1000;
      const likelyRetry =
        storedToken.revokedReason === "rotated" && Boolean(storedToken.replacedByTokenId) && inGracePeriod;

      if (!likelyRetry) {
        await this.processReuseDetection(storedToken, actorType, context);
      }
      this.throwAuthFailed();
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user || !user.isActive) {
      this.throwAuthFailed();
    }
    const activeUser = user;

    if (actorType === AuthActorType.ADMIN && this.isStrictAdminAuthEnabled() && this.isAdminIpRestrictionEnabled()) {
      const allowed = this.isAdminIpAllowed(ipAddress);
      if (!allowed) {
        await this.usersService.createAuthRiskEvent({
          userId: activeUser.id,
          sessionId: storedToken.sessionId,
          familyId: storedToken.familyId,
          actorType,
          riskType: AuthRiskType.ADMIN_IP_BLOCKED,
          severity: AuthRiskSeverity.HIGH,
          reason: "admin_ip_restriction_blocked_refresh",
          ipAddress,
          userAgent
        });
        this.throwAuthFailed();
      }
    }

    const rotated = await this.issueTokenPair(
      activeUser,
      actorType,
      context,
      {
        refreshTokenId: storedToken.id,
        sessionId: storedToken.sessionId,
        familyId: storedToken.familyId
      }
    );

    return {
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken
    };
  }

  async logout(refreshToken: string, allSessions = false, context?: AuthRequestContext) {
    const verified = await this.verifyRefreshToken(refreshToken, { ignoreExpiration: true });
    const payload = verified.payload;
    const actorType = payload.at ?? verified.actorType ?? AuthActorType.PUBLIC;

    if (payload.type !== "refresh" || !payload.sub) {
      return { revoked: 0 };
    }

    const ipAddress = context?.ipAddress ?? "unknown";
    const userAgent = context?.userAgent;

    if (allSessions) {
      const result = await this.usersService.revokeAllAuthSessions(payload.sub, actorType, "global_logout");
      await this.usersService.createAuthRiskEvent({
        userId: payload.sub,
        actorType,
        riskType: AuthRiskType.GLOBAL_LOGOUT,
        severity: AuthRiskSeverity.INFO,
        reason: "global_logout",
        ipAddress,
        userAgent
      });
      return { revoked: result.count };
    }

    const match = await this.resolveStoredRefreshToken(payload.sub, refreshToken, payload);
    if (!match.token || match.state === "missing") {
      return { revoked: 0 };
    }

    const token = match.token;
    if (token.sessionId) {
      const result = await this.usersService.revokeAuthSession(token.sessionId, "logout");
      await this.usersService.createRefreshTokenEvent({
        userId: token.userId,
        familyId: token.familyId,
        tokenId: token.id,
        eventType: RefreshTokenEventType.REVOKED,
        reason: "logout",
        ipAddress,
        userAgent
      });
      return { revoked: result.count };
    }

    const result = await this.usersService.revokeRefreshTokenById(token.id, "logout");
    await this.usersService.createRefreshTokenEvent({
      userId: token.userId,
      familyId: token.familyId,
      tokenId: token.id,
      eventType: RefreshTokenEventType.REVOKED,
      reason: "logout",
      ipAddress,
      userAgent
    });
    return { revoked: result.count };
  }

  async listAdminSessions(input: { userId?: string; includeRevoked?: boolean; limit?: number }) {
    return this.usersService.findAuthSessions(input);
  }

  async listAuthRiskEvents(limit?: number) {
    return this.usersService.findAuthRiskEvents(limit ?? 100);
  }

  async listLoginAttempts(limit?: number) {
    return this.usersService.findLoginAttempts(limit ?? 100);
  }

  async listRefreshTokenEvents(limit?: number) {
    return this.usersService.findRefreshTokenEvents(limit ?? 100);
  }

  async revokeAdminSession(sessionId: string, actorUserId: string, reason?: string) {
    const result = await this.usersService.revokeAuthSession(sessionId, reason ?? "admin_revoke");
    await this.usersService.createAuthRiskEvent({
      userId: actorUserId,
      sessionId,
      actorType: AuthActorType.ADMIN,
      riskType: AuthRiskType.SESSION_REVOKED,
      severity: AuthRiskSeverity.INFO,
      reason: reason ?? "admin_revoke_session"
    });
    await this.prisma.auditLog.create({
      data: {
        userId: actorUserId,
        action: "admin.session.revoke",
        resourceType: "auth_session",
        resourceId: sessionId,
        metadata: {
          reason: reason ?? "admin_revoke"
        }
      }
    });
    return { revoked: result.count };
  }

  async createAdminStepUpChallenge(userId: string, sessionId?: string, context?: AuthRequestContext, reason?: string) {
    const challengeCode = String(randomInt(100000, 999999));
    const challengeHash = await bcrypt.hash(challengeCode, 10);
    const expiresAt = new Date(Date.now() + parseInteger(process.env.ADMIN_STEP_UP_TTL_SECONDS, 300) * 1000);

    const challenge = await this.usersService.createAdminStepUpChallenge({
      userId,
      sessionId,
      challengeHash,
      expiresAt,
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent,
      reason
    });

    return {
      challengeId: challenge.id,
      challengeCode,
      expiresAt: challenge.expiresAt.toISOString()
    };
  }

  async verifyAdminStepUpChallenge(
    userId: string,
    input: { challengeId: string; challengeCode: string; password: string },
    context?: AuthRequestContext
  ) {
    const challenge = await this.usersService.findAdminStepUpChallenge(input.challengeId, userId);
    if (!challenge || challenge.status !== AdminStepUpStatus.PENDING) {
      this.throwAuthFailed();
    }

    if (challenge.expiresAt.getTime() <= Date.now()) {
      await this.usersService.updateAdminStepUpChallenge(challenge.id, { status: AdminStepUpStatus.EXPIRED });
      this.throwAuthFailed();
    }

    const codeOk = await bcrypt.compare(input.challengeCode, challenge.challengeHash);
    const user = await this.usersService.findById(userId);
    const passwordOk = user ? await bcrypt.compare(input.password, user.passwordHash) : false;
    if (!codeOk || !passwordOk) {
      const attempts = challenge.failedAttempts + 1;
      const status = attempts >= challenge.maxAttempts ? AdminStepUpStatus.FAILED : undefined;
      await this.usersService.updateAdminStepUpChallenge(challenge.id, {
        failedAttempts: attempts,
        ...(status ? { status } : {})
      });
      await this.usersService.createAuthRiskEvent({
        userId,
        sessionId: challenge.sessionId,
        actorType: AuthActorType.ADMIN,
        riskType: AuthRiskType.STEP_UP_FAILURE,
        severity: AuthRiskSeverity.WARNING,
        reason: "admin_step_up_verification_failed",
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
        metadata: {
          failedAttempts: attempts
        }
      });
      this.throwAuthFailed();
    }

    await this.usersService.updateAdminStepUpChallenge(challenge.id, {
      status: AdminStepUpStatus.VERIFIED,
      verifiedAt: new Date()
    });
    if (challenge.sessionId) {
      await this.prisma.adminAccessSession.updateMany({
        where: {
          sessionId: challenge.sessionId,
          status: AuthSessionStatus.ACTIVE
        },
        data: {
          stepUpVerifiedAt: new Date(),
          stepUpRequired: false
        }
      });
    }

    await this.usersService.createAuthRiskEvent({
      userId,
      sessionId: challenge.sessionId,
      actorType: AuthActorType.ADMIN,
      riskType: AuthRiskType.STEP_UP_SUCCESS,
      severity: AuthRiskSeverity.INFO,
      reason: "admin_step_up_verified",
      ipAddress: context?.ipAddress,
      userAgent: context?.userAgent
    });

    return {
      verified: true,
      sessionId: challenge.sessionId,
      proof: randomBytes(16).toString("hex")
    };
  }
}
