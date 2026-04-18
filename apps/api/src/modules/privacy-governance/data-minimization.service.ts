import { Injectable } from "@nestjs/common";
import { DataClassificationLevel } from "@prisma/client";
import { createHash } from "node:crypto";
import { DataClassificationService } from "./data-classification.service";

const SENSITIVE_KEY_PATTERN = /(password|secret|token|credential|cookie|api[_-]?key|authorization)/i;
const PUBLIC_BLOCKLIST_PATTERN = /(security|audit|incident|governance|compliance|internal|secret|token|credential|service_identity)/i;

@Injectable()
export class DataMinimizationService {
  constructor(private readonly dataClassificationService: DataClassificationService) {}

  hashValue(value: string) {
    return createHash("sha256").update(value).digest("hex").slice(0, 20);
  }

  maskValue(value: string) {
    const normalized = value.trim();
    if (normalized.length <= 4) {
      return "*".repeat(normalized.length);
    }
    return `${normalized.slice(0, 2)}${"*".repeat(Math.max(4, normalized.length - 4))}${normalized.slice(-2)}`;
  }

  maskEmail(email: string) {
    const normalized = email.trim().toLowerCase();
    const [localPart, domain] = normalized.split("@");
    if (!localPart || !domain) {
      return this.maskValue(email);
    }
    if (localPart.length <= 2) {
      return `${localPart[0] ?? "*"}*@${domain}`;
    }
    return `${localPart.slice(0, 2)}***@${domain}`;
  }

  maskIpAddress(value: string) {
    const normalized = value.trim();
    if (normalized.includes(":")) {
      return `${normalized.split(":").slice(0, 2).join(":")}::`;
    }
    const parts = normalized.split(".");
    if (parts.length !== 4) {
      return this.maskValue(normalized);
    }
    return `${parts[0]}.${parts[1]}.*.*`;
  }

  sanitizeLogRecord(input: Record<string, unknown>) {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (value === null || value === undefined) {
        result[key] = value;
        continue;
      }

      if (typeof value === "string") {
        if (SENSITIVE_KEY_PATTERN.test(key)) {
          result[key] = this.maskValue(value);
          continue;
        }
        if (key.toLowerCase().includes("email")) {
          result[key] = this.maskEmail(value);
          continue;
        }
        if (key.toLowerCase().includes("ip")) {
          result[key] = this.maskIpAddress(value);
          continue;
        }
        result[key] = value;
        continue;
      }

      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          typeof item === "string" ? (SENSITIVE_KEY_PATTERN.test(key) ? this.maskValue(item) : item) : item
        );
        continue;
      }

      if (typeof value === "object") {
        result[key] = this.sanitizeLogRecord(value as Record<string, unknown>);
        continue;
      }

      result[key] = value;
    }
    return result;
  }

  redactForClassification<T>(value: T, classification: DataClassificationLevel): T | Record<string, unknown> | string | null {
    if (value === null || value === undefined) {
      return value;
    }
    if (classification === DataClassificationLevel.PUBLIC || classification === DataClassificationLevel.INTERNAL) {
      return value;
    }

    if (typeof value === "string") {
      if (value.includes("@")) {
        return this.maskEmail(value);
      }
      if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value) || value.includes(":")) {
        return this.maskIpAddress(value);
      }
      if (classification === DataClassificationLevel.PII) {
        return this.maskValue(value);
      }
      return `h_${this.hashValue(value)}`;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      return classification === DataClassificationLevel.CONFIDENTIAL ? ("[redacted]" as any) : value;
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.redactForClassification(item, classification)) as any;
    }

    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      for (const [key, inner] of Object.entries(record)) {
        if (SENSITIVE_KEY_PATTERN.test(key) || classification === DataClassificationLevel.RESTRICTED) {
          output[key] = "[redacted]";
        } else {
          output[key] = this.redactForClassification(inner, classification);
        }
      }
      return output;
    }

    return "[redacted]";
  }

  sanitizePublicPayload(input: Record<string, unknown>) {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(input)) {
      if (PUBLIC_BLOCKLIST_PATTERN.test(key)) {
        continue;
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        output[key] = this.sanitizePublicPayload(value as Record<string, unknown>);
        continue;
      }
      output[key] = value;
    }
    return output;
  }

  async sanitizeForRole(input: {
    domain: string;
    entity: string;
    fieldName?: string | null;
    value: unknown;
    role?: string | null;
  }) {
    const classification = await this.dataClassificationService.resolveClassification({
      domain: input.domain,
      entity: input.entity,
      fieldName: input.fieldName ?? "*"
    });
    const shouldRedact = this.dataClassificationService.shouldRedactForRole(classification.dataClass, input.role);
    if (!shouldRedact) {
      return input.value;
    }
    return this.redactForClassification(input.value, classification.dataClass);
  }

  anonymizeUserProfile(input: { email?: string | null; userId: string }) {
    const hash = this.hashValue(input.userId);
    return {
      email: input.email ? `deleted+${hash}@redacted.local` : null,
      displayName: `deleted-user-${hash.slice(0, 8)}`
    };
  }
}
