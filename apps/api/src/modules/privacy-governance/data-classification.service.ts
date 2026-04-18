import { Injectable } from "@nestjs/common";
import { AccessActorType, DataClassificationLevel, SecurityEventSeverity } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityEventService } from "../security-events/security-event.service";
import { ClassificationMapping } from "./privacy-governance.types";

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

function normalize(value: string | null | undefined, fallback: string) {
  if (!value) {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

const DEFAULT_DOMAIN_CLASSIFICATIONS: Omit<ClassificationMapping, "policyVersion">[] = [
  { domain: "auth", entity: "auth_sessions", fieldName: "*", dataClass: DataClassificationLevel.CONFIDENTIAL, redactionStrategy: "mask" },
  { domain: "auth", entity: "refresh_tokens", fieldName: "*", dataClass: DataClassificationLevel.RESTRICTED, redactionStrategy: "hash" },
  { domain: "auth", entity: "users", fieldName: "email", dataClass: DataClassificationLevel.PII, redactionStrategy: "mask_email" },
  { domain: "security", entity: "audit_events", fieldName: "*", dataClass: DataClassificationLevel.RESTRICTED, redactionStrategy: "restricted_admin_only" },
  { domain: "security", entity: "security_events", fieldName: "*", dataClass: DataClassificationLevel.RESTRICTED, redactionStrategy: "restricted_admin_only" },
  { domain: "provider", entity: "raw_provider_payloads", fieldName: "*", dataClass: DataClassificationLevel.RESTRICTED, redactionStrategy: "hash_payload" },
  { domain: "prediction", entity: "prediction_runs", fieldName: "*", dataClass: DataClassificationLevel.INTERNAL, redactionStrategy: "none" },
  { domain: "bankroll", entity: "bankroll_accounts", fieldName: "*", dataClass: DataClassificationLevel.CONFIDENTIAL, redactionStrategy: "mask" },
  { domain: "research", entity: "research_runs", fieldName: "*", dataClass: DataClassificationLevel.INTERNAL, redactionStrategy: "none" },
  { domain: "compliance", entity: "privacy_deletion_jobs", fieldName: "*", dataClass: DataClassificationLevel.RESTRICTED, redactionStrategy: "restricted_admin_only" },
  { domain: "compliance", entity: "privacy_export_jobs", fieldName: "*", dataClass: DataClassificationLevel.RESTRICTED, redactionStrategy: "restricted_admin_only" },
  { domain: "public", entity: "published_predictions", fieldName: "*", dataClass: DataClassificationLevel.PUBLIC, redactionStrategy: "none" }
];

@Injectable()
export class DataClassificationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService
  ) {}

  isEnabled() {
    return parseBoolean(process.env.PRIVACY_GOVERNANCE_ENABLED, true);
  }

  resolvePolicyVersion() {
    return normalize(process.env.COMPLIANCE_POLICY_VERSION, "v1");
  }

  private classificationOrder(level: DataClassificationLevel) {
    const order: Record<DataClassificationLevel, number> = {
      PUBLIC: 1,
      INTERNAL: 2,
      CONFIDENTIAL: 3,
      RESTRICTED: 4,
      PII: 5
    };
    return order[level];
  }

  async syncDefaultClassifications() {
    const policyVersion = this.resolvePolicyVersion();
    const applied: string[] = [];

    for (const item of DEFAULT_DOMAIN_CLASSIFICATIONS) {
      const existing = await this.prisma.dataClassification.findFirst({
        where: {
          domain: item.domain,
          entity: item.entity,
          fieldName: item.fieldName,
          policyVersion
        }
      });

      if (existing) {
        await this.prisma.dataClassification.update({
          where: { id: existing.id },
          data: {
            dataClass: item.dataClass,
            redactionStrategy: item.redactionStrategy ?? null,
            active: true
          }
        });
      } else {
        await this.prisma.dataClassification.create({
          data: {
            domain: item.domain,
            entity: item.entity,
            fieldName: item.fieldName,
            dataClass: item.dataClass,
            redactionStrategy: item.redactionStrategy ?? null,
            policyVersion,
            active: true
          }
        });
      }
      applied.push(`${item.domain}:${item.entity}:${item.fieldName}`);
    }

    await this.securityEventService.emitAuditEvent({
      actorType: AccessActorType.SYSTEM,
      action: "governance.classification.sync_defaults",
      resourceType: "data_classification",
      reason: "phase5_default_classification_sync",
      severity: SecurityEventSeverity.MEDIUM,
      metadata: {
        policyVersion,
        applied
      }
    });

    return {
      policyVersion,
      appliedCount: applied.length,
      applied
    };
  }

  listClassifications(limit = 400) {
    return this.prisma.dataClassification.findMany({
      where: { active: true },
      orderBy: [{ domain: "asc" }, { entity: "asc" }, { fieldName: "asc" }],
      take: Math.max(1, Math.min(limit, 5000))
    });
  }

  async resolveClassification(input: { domain: string; entity: string; fieldName?: string | null; policyVersion?: string | null }) {
    const policyVersion = normalize(input.policyVersion, this.resolvePolicyVersion());
    const fieldName = normalize(input.fieldName, "*");

    const exact = await this.prisma.dataClassification.findFirst({
      where: {
        domain: input.domain,
        entity: input.entity,
        fieldName,
        policyVersion,
        active: true
      },
      orderBy: { updatedAt: "desc" }
    });

    if (exact) {
      return exact;
    }

    const wildcard = await this.prisma.dataClassification.findFirst({
      where: {
        domain: input.domain,
        entity: input.entity,
        fieldName: "*",
        policyVersion,
        active: true
      },
      orderBy: { updatedAt: "desc" }
    });

    if (wildcard) {
      return wildcard;
    }

    return {
      domain: input.domain,
      entity: input.entity,
      fieldName,
      dataClass: DataClassificationLevel.INTERNAL,
      redactionStrategy: "mask",
      policyVersion
    };
  }

  shouldRedactForRole(dataClass: DataClassificationLevel, role?: string | null) {
    const normalizedRole = normalize(role, "").toLowerCase();
    if (normalizedRole === "super_admin") {
      return false;
    }
    if (normalizedRole === "admin") {
      return dataClass === DataClassificationLevel.PII || dataClass === DataClassificationLevel.RESTRICTED;
    }
    return dataClass !== DataClassificationLevel.PUBLIC;
  }

  compareClassifications(left: DataClassificationLevel, right: DataClassificationLevel) {
    return this.classificationOrder(left) - this.classificationOrder(right);
  }
}
