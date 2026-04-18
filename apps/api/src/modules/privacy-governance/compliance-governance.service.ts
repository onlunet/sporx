import { Injectable } from "@nestjs/common";
import { AccessActorType, DataClassificationLevel, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityEventService } from "../security-events/security-event.service";
import { ComplianceDecisionInput, ComplianceDecisionResult } from "./privacy-governance.types";

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

@Injectable()
export class ComplianceGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService
  ) {}

  isPrivacyGovernanceEnabled() {
    return parseBoolean(process.env.PRIVACY_GOVERNANCE_ENABLED, true);
  }

  isPolicyEnforced() {
    return parseBoolean(process.env.COMPLIANCE_POLICY_ENFORCED, true);
  }

  isLegalHoldHooksEnabled() {
    return parseBoolean(process.env.LEGAL_HOLD_HOOKS_ENABLED, true);
  }

  resolvePolicyVersion(input?: string | null) {
    return normalize(input, normalize(process.env.COMPLIANCE_POLICY_VERSION, "v1"));
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  private parseLegalHoldDomains(raw: string | null | undefined) {
    if (!raw) {
      return [];
    }
    return raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
  }

  private async resolveLegalHoldDomains() {
    const fromEnv = this.parseLegalHoldDomains(process.env.LEGAL_HOLD_DOMAINS);
    const fromSetting = await this.prisma.systemSetting.findUnique({
      where: { key: "compliance.legal_hold.domains" }
    });

    let fromDb: string[] = [];
    if (fromSetting?.value) {
      if (Array.isArray(fromSetting.value)) {
        fromDb = (fromSetting.value as unknown[])
          .map((item) => String(item).trim().toLowerCase())
          .filter(Boolean);
      } else if (typeof fromSetting.value === "string") {
        fromDb = this.parseLegalHoldDomains(fromSetting.value);
      }
    }
    return Array.from(new Set([...fromEnv, ...fromDb]));
  }

  private immutableGuardFor(input: ComplianceDecisionInput) {
    if (input.operation !== "privacy_delete" && input.operation !== "retention_cleanup") {
      return false;
    }
    if (!input.dataClass) {
      return false;
    }
    return input.dataClass === DataClassificationLevel.RESTRICTED;
  }

  async evaluatePolicy(input: ComplianceDecisionInput): Promise<ComplianceDecisionResult> {
    const policyVersion = this.resolvePolicyVersion(input.policyVersion);
    const dryRun = input.dryRun ?? true;
    const decisionSeed = JSON.stringify({
      operation: input.operation,
      domain: input.domain.toLowerCase(),
      dataClass: input.dataClass ?? null,
      policyVersion,
      legalBasisHook: input.legalBasisHook ?? null,
      dryRun,
      scope: input.scope ?? {}
    });
    const decisionKey = this.hash(decisionSeed);

    const legalHoldDomains = this.isLegalHoldHooksEnabled() ? await this.resolveLegalHoldDomains() : [];
    const legalHoldBlocked = legalHoldDomains.includes(input.domain.toLowerCase());
    const immutableGuard = this.immutableGuardFor(input);

    let approved = true;
    let reason = "policy_approved";
    if (!this.isPrivacyGovernanceEnabled()) {
      approved = false;
      reason = "privacy_governance_disabled";
    } else if (!this.isPolicyEnforced()) {
      approved = true;
      reason = "policy_enforcement_disabled";
    } else if (legalHoldBlocked && !dryRun) {
      approved = false;
      reason = "blocked_by_legal_hold";
    } else if (immutableGuard && !dryRun && input.operation === "retention_cleanup") {
      approved = false;
      reason = "immutable_data_cleanup_blocked";
    } else if (input.operation === "privacy_delete" && !dryRun && !input.legalBasisHook) {
      approved = false;
      reason = "missing_legal_basis_hook";
    }

    const result: ComplianceDecisionResult = {
      decisionKey,
      operation: input.operation,
      policyVersion,
      approved,
      legalHoldBlocked,
      reason,
      dryRun,
      immutableGuard
    };

    await this.securityEventService.emitAuditEvent({
      eventKey: `audit:compliance.policy_decision:${decisionKey}`,
      actorType: input.actorType ?? AccessActorType.SYSTEM,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      action: "compliance.policy.decision",
      resourceType: "compliance_policy",
      resourceId: policyVersion,
      decisionResult: approved ? "APPROVED" : "REJECTED",
      reason,
      severity: approved ? SecurityEventSeverity.INFO : SecurityEventSeverity.HIGH,
      context: input.context,
      metadata: {
        operation: input.operation,
        domain: input.domain,
        dataClass: input.dataClass ?? null,
        dryRun,
        legalHoldBlocked,
        immutableGuard
      }
    });

    await this.securityEventService.emitSecurityEvent({
      eventKey: `security:compliance.policy_decision:${decisionKey}`,
      sourceDomain: SecurityEventSourceDomain.COMPLIANCE,
      eventType: "compliance_policy_decision",
      severity: approved ? SecurityEventSeverity.INFO : SecurityEventSeverity.MEDIUM,
      actorType: input.actorType ?? AccessActorType.SYSTEM,
      actorId: input.actorId ?? null,
      serviceIdentityId: input.serviceIdentityId ?? null,
      targetResourceType: "compliance_policy",
      targetResourceId: policyVersion,
      decisionResult: approved ? "APPROVED" : "REJECTED",
      reason,
      context: input.context,
      metadata: {
        decisionKey,
        operation: input.operation,
        domain: input.domain,
        dryRun
      }
    });

    return result;
  }

  async listLegalHoldIndicators() {
    const domains = await this.resolveLegalHoldDomains();
    return {
      enabled: this.isLegalHoldHooksEnabled(),
      domains
    };
  }

  async updateLegalHoldDomains(input: { domains: string[] }) {
    const normalized = Array.from(
      new Set(
        input.domains
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean)
      )
    );
    const setting = await this.prisma.systemSetting.upsert({
      where: { key: "compliance.legal_hold.domains" },
      update: { value: normalized as any },
      create: {
        key: "compliance.legal_hold.domains",
        value: normalized as any,
        description: "Legal-hold protected domains for privacy/retention execution"
      }
    });

    await this.securityEventService.emitAuditEvent({
      actorType: AccessActorType.ADMIN,
      action: "compliance.legal_hold.update",
      resourceType: "system_setting",
      resourceId: setting.key,
      reason: "legal_hold_domains_updated",
      severity: SecurityEventSeverity.HIGH,
      metadata: { domains: normalized }
    });

    return {
      key: setting.key,
      domains: normalized
    };
  }

  listComplianceActionAudit(limit = 300) {
    return this.prisma.auditEvent.findMany({
      where: {
        action: {
          startsWith: "compliance."
        }
      },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 4000))
    });
  }
}
