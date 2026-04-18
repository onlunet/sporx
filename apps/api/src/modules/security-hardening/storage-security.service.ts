import { Injectable } from "@nestjs/common";
import { AccessActorType, SecurityEventSeverity } from "@prisma/client";
import { createHash } from "node:crypto";
import { SecurityEventService } from "../security-events/security-event.service";

const SENSITIVE_COMPONENT_PATTERN = /(secret|token|password|credential|apikey|api_key|bearer|authorization|cookie|session)/i;

@Injectable()
export class StorageSecurityService {
  constructor(private readonly securityEventService: SecurityEventService) {}

  resolveEnvironment() {
    const env = process.env.APP_ENV?.trim() || process.env.NODE_ENV?.trim() || "development";
    if (env === "production" || env === "staging") {
      return env;
    }
    return "development";
  }

  isSensitiveComponent(value: string) {
    return SENSITIVE_COMPONENT_PATTERN.test(value);
  }

  hashComponent(value: string) {
    return createHash("sha256").update(value).digest("hex").slice(0, 20);
  }

  buildSafeCacheKey(input: {
    namespace: string;
    bucket: string;
    parts: Array<string | number | boolean | null | undefined>;
    environment?: string;
  }) {
    const env = (input.environment?.trim() || this.resolveEnvironment()).toLowerCase();
    const sanitize = (value: string) => value.replace(/[:\s]+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
    const normalizedParts = input.parts
      .map((value) => (value === null || value === undefined ? "" : String(value).trim()))
      .filter((value) => value.length > 0)
      .map((value) => (this.isSensitiveComponent(value) ? `h_${this.hashComponent(value)}` : sanitize(value)));
    const key = ["sporx", env, sanitize(input.namespace), sanitize(input.bucket), ...normalizedParts].join(":");
    return key.slice(0, 220);
  }

  assertSafeCacheKey(key: string) {
    const tokens = key.split(":");
    for (const token of tokens) {
      if (this.isSensitiveComponent(token) && !token.startsWith("h_")) {
        throw new Error(`Sensitive token detected in cache key: ${token}`);
      }
    }
  }

  resolveRedisNamespace(queueClass: "auth" | "security" | "queue" | "cache" | "runtime") {
    const env = this.resolveEnvironment();
    return `sporx:${env}:${queueClass}`;
  }

  defaultTtlFor(category: "auth_session" | "security_event_cache" | "rate_limit" | "queue_lock" | "general") {
    if (category === "auth_session") {
      return 15 * 60;
    }
    if (category === "security_event_cache") {
      return 10 * 60;
    }
    if (category === "rate_limit") {
      return 60;
    }
    if (category === "queue_lock") {
      return 30;
    }
    return 120;
  }

  async recordRawQueryUsage(input: {
    querySignature: string;
    resourceType: string;
    actorType?: AccessActorType;
    actorId?: string | null;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    await this.securityEventService.emitAuditEvent({
      actorType: input.actorType ?? AccessActorType.SYSTEM,
      actorId: input.actorId ?? null,
      action: "storage.raw_query.usage",
      resourceType: input.resourceType,
      reason: input.reason ?? "raw_query_usage",
      severity: SecurityEventSeverity.MEDIUM,
      metadata: {
        querySignature: this.hashComponent(input.querySignature),
        ...(input.metadata ?? {})
      }
    });
  }
}
