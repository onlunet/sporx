import { Injectable } from "@nestjs/common";
import { AccessActorType, AbuseEventType, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityEventService } from "../security-events/security-event.service";

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

function trim(value: string | undefined | null) {
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

@Injectable()
export class APISecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService
  ) {}

  isStrictApiValidationEnabled() {
    return parseBoolean(process.env.STRICT_API_VALIDATION_ENABLED, true);
  }

  isStrictCorsEnabled() {
    return parseBoolean(process.env.STRICT_CORS_ENABLED, true);
  }

  isStrictSecurityHeadersEnabled() {
    return parseBoolean(process.env.STRICT_SECURITY_HEADERS_ENABLED, true);
  }

  isCsrfProtectionEnabled() {
    return parseBoolean(process.env.CSRF_PROTECTION_ENABLED, false);
  }

  resolveEnvironment() {
    const env = trim(process.env.APP_ENV) ?? trim(process.env.NODE_ENV) ?? "development";
    if (env === "production" || env === "staging") {
      return env;
    }
    return "development";
  }

  resolveBodyLimit() {
    const raw = Number.parseInt(process.env.API_REQUEST_BODY_LIMIT_BYTES ?? "", 10);
    if (Number.isFinite(raw) && raw > 0) {
      return Math.max(32 * 1024, Math.min(raw, 5 * 1024 * 1024));
    }
    return this.isStrictApiValidationEnabled() ? 256 * 1024 : 1024 * 1024;
  }

  resolveBodyLimitAsString() {
    const bytes = this.resolveBodyLimit();
    if (bytes % (1024 * 1024) === 0) {
      return `${bytes / (1024 * 1024)}mb`;
    }
    return `${Math.ceil(bytes / 1024)}kb`;
  }

  resolveAllowedCorsOrigins() {
    return (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3100")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  validateCorsPolicyForEnvironment(environment = this.resolveEnvironment()) {
    const origins = this.resolveAllowedCorsOrigins();
    const issues: string[] = [];
    if (environment === "production" && this.isStrictCorsEnabled()) {
      if (origins.length === 0) {
        issues.push("CORS_ORIGINS is empty in production");
      }
      if (origins.some((origin) => origin === "*" || origin.includes("localhost") || origin.includes("127.0.0.1"))) {
        issues.push("CORS_ORIGINS includes wildcard or localhost in production");
      }
    }
    return {
      ok: issues.length === 0,
      origins,
      issues
    };
  }

  sanitizeErrorMessage(status: number, message: unknown) {
    if (status >= 500) {
      return "Internal server error";
    }

    const raw = typeof message === "string" ? message : "Request failed";
    if (/secret|token|password|credential|apikey/i.test(raw)) {
      return "Request failed";
    }

    if (status === 401 || status === 403) {
      return "Access denied";
    }
    if (status === 429) {
      return "Too many requests. Please retry later.";
    }
    return raw;
  }

  assignRequestCorrelation(request: Request, response: Response) {
    const requestHeader = request.headers["x-request-id"];
    const correlationHeader = request.headers["x-correlation-id"];
    const traceHeader = request.headers["x-trace-id"];

    const requestId =
      (Array.isArray(requestHeader) ? requestHeader[0] : requestHeader) ??
      randomUUID();
    const correlationId =
      (Array.isArray(correlationHeader) ? correlationHeader[0] : correlationHeader) ??
      requestId;
    const traceId = (Array.isArray(traceHeader) ? traceHeader[0] : traceHeader) ?? correlationId;

    request.headers["x-request-id"] = requestId;
    request.headers["x-correlation-id"] = correlationId;
    request.headers["x-trace-id"] = traceId;

    response.setHeader("x-request-id", requestId);
    response.setHeader("x-correlation-id", correlationId);
    response.setHeader("x-trace-id", traceId);
  }

  buildSecurityHeaders() {
    const headers: Record<string, string> = {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), microphone=(), payment=(), usb=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-site",
      "X-DNS-Prefetch-Control": "off"
    };

    const env = this.resolveEnvironment();
    if (env === "production") {
      headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
    }

    const configuredCsp = trim(process.env.SECURITY_CSP);
    if (configuredCsp) {
      headers["Content-Security-Policy"] = configuredCsp;
    } else {
      headers["Content-Security-Policy"] = "default-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'";
    }

    return headers;
  }

  applySecurityHeaders(response: Response) {
    if (!this.isStrictSecurityHeadersEnabled()) {
      return;
    }
    const headers = this.buildSecurityHeaders();
    for (const [key, value] of Object.entries(headers)) {
      response.setHeader(key, value);
    }
  }

  private parseClientIp(request: Request) {
    const forwarded = request.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      return forwarded.split(",")[0]?.trim() ?? request.ip ?? "unknown";
    }
    if (Array.isArray(forwarded) && forwarded.length > 0) {
      return forwarded[0]?.trim() ?? request.ip ?? "unknown";
    }
    return request.ip ?? "unknown";
  }

  async recordRateLimitBucket(input: {
    ruleId: string;
    limit: number;
    hits: number;
    remainingSeconds: number;
    blocked: boolean;
    ipAddress: string;
    requestId?: string | null;
    correlationId?: string | null;
  }) {
    const windowToken = Math.floor(Date.now() / ((input.remainingSeconds > 0 ? input.remainingSeconds : 60) * 1000));
    const bucketKey = `${input.ruleId}:${input.ipAddress}:${windowToken}`;

    await this.prisma.rateLimitBucket.upsert({
      where: { bucketKey },
      update: {
        hits: input.hits,
        blockedCount: input.blocked ? { increment: 1 } : undefined,
        lastSeenAt: new Date(),
        lastBlockedAt: input.blocked ? new Date() : undefined,
        metadata: {
          requestId: input.requestId ?? null,
          correlationId: input.correlationId ?? null
        } as any
      },
      create: {
        bucketKey,
        ruleId: input.ruleId,
        actorType: AccessActorType.USER,
        ipAddress: input.ipAddress,
        hits: input.hits,
        blockedCount: input.blocked ? 1 : 0,
        windowSeconds: Math.max(1, input.remainingSeconds),
        limitValue: input.limit,
        lastSeenAt: new Date(),
        lastBlockedAt: input.blocked ? new Date() : null,
        environment: this.resolveEnvironment(),
        metadata: {
          requestId: input.requestId ?? null,
          correlationId: input.correlationId ?? null
        } as any
      }
    });
  }

  async emitSuspiciousRequestEvent(request: Request, reason: string) {
    const context = this.securityEventService.resolveRequestContext(request);
    await this.securityEventService.emitAbuseEvent({
      eventType: AbuseEventType.OTHER,
      sourceDomain: SecurityEventSourceDomain.RUNTIME,
      severity: SecurityEventSeverity.MEDIUM,
      actorType: AccessActorType.USER,
      method: request.method,
      path: request.path,
      reason,
      context,
      metadata: {
        ipAddress: this.parseClientIp(request)
      }
    });
  }

  isSuspiciousPath(path: string) {
    const normalized = path.toLowerCase();
    return normalized.includes("../") || normalized.includes("..\\") || normalized.includes("%2e%2e");
  }

  shouldRejectMissingCsrf(request: Request) {
    if (!this.isCsrfProtectionEnabled()) {
      return false;
    }
    const method = request.method.toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) {
      return false;
    }
    const cookieHeader = request.headers.cookie;
    if (!cookieHeader || cookieHeader.length === 0) {
      return false;
    }
    const csrfHeader = request.headers["x-csrf-token"];
    const token = Array.isArray(csrfHeader) ? csrfHeader[0] : csrfHeader;
    return !token || token.trim().length < 8;
  }

  listRateLimitBuckets(limit = 200) {
    return this.prisma.rateLimitBucket.findMany({
      orderBy: { lastSeenAt: "desc" },
      take: Math.max(1, Math.min(2000, limit))
    });
  }
}
