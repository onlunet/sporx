import { Injectable } from "@nestjs/common";
import { AccessActorType, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityEventService } from "../security-events/security-event.service";
import { SecretRotationInput, SecretStartupCheckResult } from "./security-hardening.types";

const SENSITIVE_KEY_PATTERN = /(secret|token|password|passwd|credential|apikey|api_key|private[_-]?key|signing[_-]?key)/i;

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
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

function clean(value: string | null | undefined) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class SecretGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService
  ) {}

  isEnabled() {
    return parseBoolean(process.env.SECRET_GOVERNANCE_ENABLED, true);
  }

  getSecret(name: string, options?: { required?: boolean; allowInDevelopment?: boolean }) {
    const value = clean(process.env[name]);
    const required = options?.required ?? false;
    const allowInDevelopment = options?.allowInDevelopment ?? false;
    const environment = this.resolveEnvironment();

    if (!value && required && !(environment === "development" && allowInDevelopment)) {
      throw new Error(`Missing required secret: ${name}`);
    }
    return value;
  }

  private resolveEnvironment(environment?: string | null) {
    const env = clean(environment) ?? clean(process.env.APP_ENV) ?? clean(process.env.NODE_ENV) ?? "development";
    if (env === "production" || env === "staging") {
      return env;
    }
    return "development";
  }

  maskSecret(value: string | null | undefined) {
    const input = clean(value);
    if (!input) {
      return null;
    }
    if (input.length <= 4) {
      return "*".repeat(input.length);
    }
    if (input.length <= 10) {
      return `${input.slice(0, 1)}${"*".repeat(input.length - 2)}${input.slice(-1)}`;
    }
    return `${input.slice(0, 3)}${"*".repeat(Math.max(4, input.length - 6))}${input.slice(-3)}`;
  }

  isSensitiveKey(key: string) {
    return SENSITIVE_KEY_PATTERN.test(key);
  }

  redactSecrets<T>(value: T): T {
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === "string") {
      return value as T;
    }
    if (typeof value !== "object") {
      return value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactSecrets(item)) as T;
    }

    const source = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [key, raw] of Object.entries(source)) {
      if (this.isSensitiveKey(key) && typeof raw === "string") {
        redacted[key] = this.maskSecret(raw) ?? "***";
        continue;
      }
      redacted[key] = this.redactSecrets(raw);
    }
    return redacted as T;
  }

  validateRequiredSecrets(environment?: string | null): SecretStartupCheckResult {
    const resolved = this.resolveEnvironment(environment);
    const required = ["DATABASE_URL", "REDIS_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"];
    if (resolved === "production") {
      required.push("CORS_ORIGINS", "ADMIN_WEB_URL");
    }

    const missingSecrets: string[] = [];
    for (const key of required) {
      if (!clean(process.env[key])) {
        missingSecrets.push(key);
      }
    }

    const insecureSecrets: string[] = [];
    if (resolved === "production") {
      const accessSecret = clean(process.env.JWT_ACCESS_SECRET);
      const refreshSecret = clean(process.env.JWT_REFRESH_SECRET);
      if (accessSecret && accessSecret.length < 32) {
        insecureSecrets.push("JWT_ACCESS_SECRET length < 32");
      }
      if (refreshSecret && refreshSecret.length < 32) {
        insecureSecrets.push("JWT_REFRESH_SECRET length < 32");
      }

      const dbUrl = clean(process.env.DATABASE_URL);
      if (dbUrl && /localhost|127\.0\.0\.1/i.test(dbUrl)) {
        insecureSecrets.push("DATABASE_URL points to localhost in production");
      }
      const redisUrl = clean(process.env.REDIS_URL);
      if (redisUrl && /localhost|127\.0\.0\.1/i.test(redisUrl)) {
        insecureSecrets.push("REDIS_URL points to localhost in production");
      }
    }

    return {
      ok: missingSecrets.length === 0 && insecureSecrets.length === 0,
      environment: resolved,
      checkedAt: new Date().toISOString(),
      missingSecrets,
      insecureSecrets
    };
  }

  async recordSecretRotation(input: SecretRotationInput) {
    if (!this.isEnabled()) {
      return null;
    }

    const rotationKey = clean(input.rotationKey);
    if (rotationKey) {
      const existing = await this.prisma.secretRotationEvent.findUnique({
        where: { rotationKey }
      });
      if (existing) {
        return existing;
      }
    }

    const redactedMetadata = input.metadata ? this.redactSecrets(input.metadata) : null;
    const created = await this.prisma.secretRotationEvent.create({
      data: {
        rotationKey,
        category: input.category,
        secretRef: input.secretRef.trim(),
        lifecycleStatus: input.lifecycleStatus,
        reason: input.reason ?? null,
        plannedAt: input.plannedAt ?? null,
        activatedAt: input.activatedAt ?? null,
        retiringAt: input.retiringAt ?? null,
        revokedAt: input.revokedAt ?? null,
        actorType: input.actorType ?? null,
        actorId: input.actorId ?? null,
        serviceIdentityId: input.serviceIdentityId ?? null,
        correlationId: input.context?.correlationId ?? null,
        traceId: input.context?.traceId ?? null,
        requestId: input.context?.requestId ?? null,
        environment: this.resolveEnvironment(input.context?.environment),
        metadata: (redactedMetadata ?? null) as any
      }
    });

    await this.securityEventService.emitAuditEvent({
      eventKey: `audit:secret_rotation:${created.id}`,
      actorType: input.actorType ?? AccessActorType.SYSTEM,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "secret.rotation.metadata",
      resourceType: "secret",
      resourceId: input.secretRef,
      reason: input.reason ?? null,
      severity: SecurityEventSeverity.HIGH,
      context: input.context,
      metadata: {
        category: input.category,
        lifecycleStatus: input.lifecycleStatus,
        rotationEventId: created.id
      }
    });

    await this.securityEventService.emitSecurityEvent({
      eventKey: `security:secret_rotation:${created.id}`,
      sourceDomain: SecurityEventSourceDomain.COMPLIANCE,
      eventType: "secret_rotation_metadata_recorded",
      severity: SecurityEventSeverity.MEDIUM,
      actorType: input.actorType ?? AccessActorType.SYSTEM,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      targetResourceType: "secret",
      targetResourceId: input.secretRef,
      reason: input.reason ?? null,
      context: input.context,
      metadata: {
        category: input.category,
        lifecycleStatus: input.lifecycleStatus
      }
    });

    return created;
  }

  listRotationEvents(limit = 200) {
    return this.prisma.secretRotationEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(2000, limit))
    });
  }

  async upsertApiKeyRegistry(input: {
    keyHash: string;
    keyPrefix?: string | null;
    ownerService?: string | null;
    status?: "PLANNED" | "ACTIVE" | "RETIRING" | "REVOKED";
    scopes?: string[] | null;
    expiresAt?: Date | null;
    retiredAt?: Date | null;
    revokedAt?: Date | null;
    environment?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    const keyHash = input.keyHash.trim();
    return this.prisma.apiKeyRegistry.upsert({
      where: { keyHash },
      update: {
        keyPrefix: input.keyPrefix ?? null,
        ownerService: input.ownerService ?? null,
        status: (input.status ?? "ACTIVE") as any,
        scopesJson: (input.scopes ?? null) as any,
        expiresAt: input.expiresAt ?? null,
        retiredAt: input.retiredAt ?? null,
        revokedAt: input.revokedAt ?? null,
        environment: input.environment ?? this.resolveEnvironment(),
        metadata: (input.metadata ? this.redactSecrets(input.metadata) : null) as any
      },
      create: {
        keyHash,
        keyPrefix: input.keyPrefix ?? null,
        ownerService: input.ownerService ?? null,
        status: (input.status ?? "ACTIVE") as any,
        scopesJson: (input.scopes ?? null) as any,
        expiresAt: input.expiresAt ?? null,
        retiredAt: input.retiredAt ?? null,
        revokedAt: input.revokedAt ?? null,
        environment: input.environment ?? this.resolveEnvironment(),
        metadata: (input.metadata ? this.redactSecrets(input.metadata) : null) as any
      }
    });
  }

  async recordApiKeyUsage(input: {
    usageKey?: string | null;
    apiKeyHash?: string | null;
    serviceIdentityId?: string | null;
    method?: string | null;
    path?: string | null;
    statusCode?: number | null;
    requestId?: string | null;
    correlationId?: string | null;
    traceId?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    environment?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    const usageKey = clean(input.usageKey);
    if (usageKey) {
      const existing = await this.prisma.apiKeyUsage.findUnique({ where: { usageKey } });
      if (existing) {
        return existing;
      }
    }

    const created = await this.prisma.apiKeyUsage.create({
      data: {
        usageKey,
        apiKeyHash: clean(input.apiKeyHash),
        serviceIdentityId: clean(input.serviceIdentityId),
        method: clean(input.method),
        path: clean(input.path),
        statusCode: input.statusCode ?? null,
        requestId: clean(input.requestId),
        correlationId: clean(input.correlationId),
        traceId: clean(input.traceId),
        ipAddress: clean(input.ipAddress),
        userAgent: clean(input.userAgent),
        environment: clean(input.environment) ?? this.resolveEnvironment(),
        metadata: (input.metadata ? this.redactSecrets(input.metadata) : null) as any
      }
    });

    if (input.apiKeyHash) {
      await this.prisma.apiKeyRegistry
        .update({
          where: { keyHash: input.apiKeyHash },
          data: {
            lastUsedAt: new Date()
          }
        })
        .catch(() => undefined);
    }
    return created;
  }

  listApiKeyRegistry(limit = 200) {
    return this.prisma.apiKeyRegistry.findMany({
      orderBy: { updatedAt: "desc" },
      take: Math.max(1, Math.min(2000, limit))
    });
  }

  listApiKeyUsages(limit = 200) {
    return this.prisma.apiKeyUsage.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(2000, limit))
    });
  }
}
