import { ForbiddenException, Injectable } from "@nestjs/common";
import { AccessActorType, AbuseEventType, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { Request } from "express";
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

function normalizeOrigin(value: string) {
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

@Injectable()
export class AdminSecurityBoundaryService {
  constructor(private readonly securityEventService: SecurityEventService) {}

  isEnabled() {
    return parseBoolean(process.env.ADMIN_SECURITY_BOUNDARY_ENABLED, true);
  }

  private allowedOrigins() {
    const entries = [
      process.env.ADMIN_WEB_URL,
      ...(process.env.ADMIN_ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    ]
      .filter((item): item is string => Boolean(item))
      .map((item) => normalizeOrigin(item));
    return Array.from(new Set(entries));
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

  private allowedIps() {
    return (process.env.ADMIN_ALLOWED_IPS ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private parseInternalServiceIdentities() {
    return (process.env.INTERNAL_SERVICE_IDENTITIES ?? process.env.SERVICE_IDENTITY ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private isAdminPath(request: Request) {
    const path = request.path.trim().toLowerCase();
    return path.startsWith("/api/v1/admin") || path.startsWith("api/v1/admin");
  }

  private isOriginAllowed(origin: string | null, referer: string | null) {
    const allowed = this.allowedOrigins();
    if (allowed.length === 0) {
      return true;
    }
    if (!origin && !referer) {
      // Internal server-to-server/admin API route calls may not carry browser origin headers.
      return true;
    }
    if (origin && allowed.includes(normalizeOrigin(origin))) {
      return true;
    }
    if (referer) {
      try {
        const parsed = new URL(referer);
        return allowed.includes(normalizeOrigin(`${parsed.protocol}//${parsed.host}`));
      } catch {
        return false;
      }
    }
    return false;
  }

  async assertAdminBoundary(request: Request) {
    if (!this.isEnabled() || !this.isAdminPath(request)) {
      return;
    }

    const identityHeader = request.headers["x-service-identity"];
    const identity = typeof identityHeader === "string" ? identityHeader.trim() : "";
    if (identity.length > 0) {
      const allowlist = this.parseInternalServiceIdentities();
      if (allowlist.includes(identity)) {
        return;
      }
    }

    if (request.headers["x-public-web-request"] === "1") {
      await this.emitBoundaryViolation(request, "public_web_authority_blocked");
      throw new ForbiddenException("Access denied");
    }

    const originHeader = request.headers.origin;
    const refererHeader = request.headers.referer;
    const origin = typeof originHeader === "string" ? originHeader : null;
    const referer = typeof refererHeader === "string" ? refererHeader : null;

    if (!this.isOriginAllowed(origin, referer)) {
      await this.emitBoundaryViolation(request, "admin_origin_not_allowed");
      throw new ForbiddenException("Access denied");
    }

    const allowedIps = this.allowedIps();
    if (allowedIps.length > 0) {
      const ip = this.parseClientIp(request);
      if (!allowedIps.includes(ip)) {
        await this.emitBoundaryViolation(request, "admin_ip_not_allowlisted");
        throw new ForbiddenException("Access denied");
      }
    }
  }

  private async emitBoundaryViolation(request: Request, reason: string) {
    const context = this.securityEventService.resolveRequestContext(request);
    await this.securityEventService.emitAbuseEvent({
      eventType: AbuseEventType.SUSPICIOUS_ADMIN_ACCESS,
      sourceDomain: SecurityEventSourceDomain.ADMIN,
      severity: SecurityEventSeverity.HIGH,
      actorType: AccessActorType.USER,
      method: request.method,
      path: request.path,
      reason,
      context,
      metadata: {
        ipAddress: this.parseClientIp(request),
        origin: request.headers.origin ?? null,
        referer: request.headers.referer ?? null
      }
    });
  }
}
