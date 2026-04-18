import { Injectable } from "@nestjs/common";
import { AccessActorType, DataClassificationLevel, RetentionActionType, SecurityEventSeverity } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityEventService } from "../security-events/security-event.service";
import { ComplianceGovernanceService } from "./compliance-governance.service";
import { RetentionDryRunItem, RetentionDryRunReport } from "./privacy-governance.types";

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

type DefaultPolicy = {
  policyKey: string;
  domain: string;
  tableName: string;
  dataClass: DataClassificationLevel;
  retentionDays: number;
  action: RetentionActionType;
  legalHoldBlockable: boolean;
  immutableProtected: boolean;
  reason: string;
};

const DEFAULT_RETENTION_POLICIES: DefaultPolicy[] = [
  {
    policyKey: "retention.auth.auth_sessions",
    domain: "auth",
    tableName: "auth_sessions",
    dataClass: DataClassificationLevel.CONFIDENTIAL,
    retentionDays: 90,
    action: RetentionActionType.DELETE,
    legalHoldBlockable: true,
    immutableProtected: false,
    reason: "Expired/revoked auth session records cleanup"
  },
  {
    policyKey: "retention.auth.login_attempts",
    domain: "auth",
    tableName: "login_attempts",
    dataClass: DataClassificationLevel.CONFIDENTIAL,
    retentionDays: 180,
    action: RetentionActionType.DELETE,
    legalHoldBlockable: true,
    immutableProtected: false,
    reason: "Login attempt telemetry retention"
  },
  {
    policyKey: "retention.auth.refresh_token_events",
    domain: "auth",
    tableName: "refresh_token_events",
    dataClass: DataClassificationLevel.RESTRICTED,
    retentionDays: 365,
    action: RetentionActionType.DELETE,
    legalHoldBlockable: true,
    immutableProtected: false,
    reason: "Refresh token event trail retention"
  },
  {
    policyKey: "retention.provider.raw_payloads",
    domain: "provider",
    tableName: "raw_provider_payloads",
    dataClass: DataClassificationLevel.RESTRICTED,
    retentionDays: 30,
    action: RetentionActionType.DELETE,
    legalHoldBlockable: true,
    immutableProtected: false,
    reason: "Provider raw payload minimization"
  },
  {
    policyKey: "retention.prediction.runs",
    domain: "prediction",
    tableName: "prediction_runs",
    dataClass: DataClassificationLevel.INTERNAL,
    retentionDays: 730,
    action: RetentionActionType.ARCHIVE,
    legalHoldBlockable: true,
    immutableProtected: false,
    reason: "Prediction run historical trace"
  },
  {
    policyKey: "retention.research.artifacts",
    domain: "research",
    tableName: "research_run_artifacts",
    dataClass: DataClassificationLevel.INTERNAL,
    retentionDays: 365,
    action: RetentionActionType.ANONYMIZE,
    legalHoldBlockable: true,
    immutableProtected: false,
    reason: "Research artifact URI minimization"
  },
  {
    policyKey: "retention.security.audit_events",
    domain: "security",
    tableName: "audit_events",
    dataClass: DataClassificationLevel.RESTRICTED,
    retentionDays: 3650,
    action: RetentionActionType.ARCHIVE,
    legalHoldBlockable: true,
    immutableProtected: true,
    reason: "Immutable governance audit history"
  },
  {
    policyKey: "retention.security.security_events",
    domain: "security",
    tableName: "security_events",
    dataClass: DataClassificationLevel.RESTRICTED,
    retentionDays: 3650,
    action: RetentionActionType.ARCHIVE,
    legalHoldBlockable: true,
    immutableProtected: true,
    reason: "Immutable security event history"
  },
  {
    policyKey: "retention.security.abuse_events",
    domain: "security",
    tableName: "abuse_events",
    dataClass: DataClassificationLevel.RESTRICTED,
    retentionDays: 730,
    action: RetentionActionType.ARCHIVE,
    legalHoldBlockable: true,
    immutableProtected: true,
    reason: "Abuse event forensics trail"
  }
];

@Injectable()
export class RetentionGovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly securityEventService: SecurityEventService,
    private readonly complianceGovernanceService: ComplianceGovernanceService
  ) {}

  isCleanupEnabled() {
    return parseBoolean(process.env.RETENTION_CLEANUP_ENABLED, true);
  }

  resolvePolicyVersion() {
    return this.complianceGovernanceService.resolvePolicyVersion();
  }

  async syncDefaultPolicies() {
    const policyVersion = this.resolvePolicyVersion();
    const applied: string[] = [];

    for (const item of DEFAULT_RETENTION_POLICIES) {
      const existing = await this.prisma.retentionPolicy.findUnique({
        where: { policyKey: item.policyKey }
      });

      if (existing) {
        await this.prisma.retentionPolicy.update({
          where: { id: existing.id },
          data: {
            domain: item.domain,
            tableName: item.tableName,
            dataClass: item.dataClass,
            retentionDays: item.retentionDays,
            action: item.action,
            legalHoldBlockable: item.legalHoldBlockable,
            immutableProtected: item.immutableProtected,
            reason: item.reason,
            policyVersion,
            active: true
          }
        });
      } else {
        await this.prisma.retentionPolicy.create({
          data: {
            policyKey: item.policyKey,
            domain: item.domain,
            tableName: item.tableName,
            dataClass: item.dataClass,
            retentionDays: item.retentionDays,
            action: item.action,
            legalHoldBlockable: item.legalHoldBlockable,
            immutableProtected: item.immutableProtected,
            reason: item.reason,
            policyVersion,
            active: true
          }
        });
      }
      applied.push(item.policyKey);
    }

    await this.securityEventService.emitAuditEvent({
      actorType: AccessActorType.SYSTEM,
      action: "compliance.retention.sync_defaults",
      resourceType: "retention_policy",
      reason: "phase5_default_retention_policy_sync",
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

  listRetentionPolicies(limit = 400) {
    return this.prisma.retentionPolicy.findMany({
      where: { active: true },
      orderBy: [{ domain: "asc" }, { tableName: "asc" }],
      take: Math.max(1, Math.min(limit, 4000))
    });
  }

  private async countCandidates(tableName: string, cutoff: Date) {
    if (tableName === "auth_sessions") {
      return this.prisma.authSession.count({
        where: {
          createdAt: { lt: cutoff },
          status: { in: ["REVOKED", "EXPIRED", "LOCKED"] }
        }
      });
    }
    if (tableName === "login_attempts") {
      return this.prisma.loginAttempt.count({
        where: { createdAt: { lt: cutoff } }
      });
    }
    if (tableName === "refresh_token_events") {
      return this.prisma.refreshTokenEvent.count({
        where: { createdAt: { lt: cutoff } }
      });
    }
    if (tableName === "raw_provider_payloads") {
      return this.prisma.rawProviderPayload.count({
        where: { createdAt: { lt: cutoff } }
      });
    }
    if (tableName === "research_run_artifacts") {
      return this.prisma.researchRunArtifact.count({
        where: { createdAt: { lt: cutoff } }
      });
    }
    if (tableName === "prediction_runs") {
      return this.prisma.predictionRun.count({
        where: { createdAt: { lt: cutoff } }
      });
    }
    if (tableName === "audit_events") {
      return this.prisma.auditEvent.count({
        where: { createdAt: { lt: cutoff } }
      });
    }
    if (tableName === "security_events") {
      return this.prisma.securityEvent.count({
        where: { createdAt: { lt: cutoff } }
      });
    }
    if (tableName === "abuse_events") {
      return this.prisma.abuseEvent.count({
        where: { createdAt: { lt: cutoff } }
      });
    }
    if (tableName === "api_logs") {
      return this.prisma.apiLog.count({
        where: { createdAt: { lt: cutoff } }
      });
    }
    return 0;
  }

  private async executeCleanupForPolicy(policy: {
    tableName: string | null;
    action: RetentionActionType;
    immutableProtected: boolean;
  }, cutoff: Date) {
    if (!policy.tableName || policy.immutableProtected) {
      return { deleted: 0, anonymized: 0 };
    }

    if (policy.tableName === "auth_sessions" && policy.action === RetentionActionType.DELETE) {
      const result = await this.prisma.authSession.deleteMany({
        where: {
          createdAt: { lt: cutoff },
          status: { in: ["REVOKED", "EXPIRED", "LOCKED"] }
        }
      });
      return { deleted: result.count, anonymized: 0 };
    }
    if (policy.tableName === "login_attempts" && policy.action === RetentionActionType.DELETE) {
      const result = await this.prisma.loginAttempt.deleteMany({
        where: { createdAt: { lt: cutoff } }
      });
      return { deleted: result.count, anonymized: 0 };
    }
    if (policy.tableName === "refresh_token_events" && policy.action === RetentionActionType.DELETE) {
      const result = await this.prisma.refreshTokenEvent.deleteMany({
        where: { createdAt: { lt: cutoff } }
      });
      return { deleted: result.count, anonymized: 0 };
    }
    if (policy.tableName === "raw_provider_payloads" && policy.action === RetentionActionType.DELETE) {
      const result = await this.prisma.rawProviderPayload.deleteMany({
        where: { createdAt: { lt: cutoff } }
      });
      return { deleted: result.count, anonymized: 0 };
    }
    if (policy.tableName === "research_run_artifacts" && policy.action === RetentionActionType.ANONYMIZE) {
      const result = await this.prisma.researchRunArtifact.updateMany({
        where: { createdAt: { lt: cutoff } },
        data: {
          artifactUri: null
        }
      });
      return { deleted: 0, anonymized: result.count };
    }

    return { deleted: 0, anonymized: 0 };
  }

  private makeReportKey(items: RetentionDryRunItem[], policyVersion: string, dryRun: boolean) {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          policyVersion,
          dryRun,
          items: items.map((item) => ({
            policyKey: item.policyKey,
            candidateCount: item.candidateCount,
            legalHoldBlocked: item.legalHoldBlocked
          }))
        })
      )
      .digest("hex");
    return digest;
  }

  async generateCleanupReport(input?: {
    domain?: string | null;
    policyKey?: string | null;
    dryRun?: boolean;
  }): Promise<RetentionDryRunReport> {
    const dryRun = input?.dryRun ?? true;
    const policyVersion = this.resolvePolicyVersion();
    const policies = await this.prisma.retentionPolicy.findMany({
      where: {
        active: true,
        ...(input?.domain ? { domain: normalize(input.domain, "").toLowerCase() } : {}),
        ...(input?.policyKey ? { policyKey: input.policyKey } : {})
      },
      orderBy: [{ domain: "asc" }, { tableName: "asc" }]
    });

    const items: RetentionDryRunItem[] = [];
    for (const policy of policies) {
      const cutoff = new Date(Date.now() - Math.max(1, policy.retentionDays) * 24 * 60 * 60 * 1000);
      const candidateCount = await this.countCandidates(policy.tableName ?? "", cutoff);

      const decision = await this.complianceGovernanceService.evaluatePolicy({
        operation: "retention_cleanup",
        domain: policy.domain,
        dataClass: policy.dataClass ?? null,
        policyVersion: policy.policyVersion,
        legalBasisHook: policy.legalBasisHook ?? null,
        dryRun,
        scope: {
          policyKey: policy.policyKey,
          tableName: policy.tableName,
          retentionDays: policy.retentionDays
        },
        actorType: AccessActorType.SYSTEM,
        reason: "retention_cleanup_report"
      });

      items.push({
        policyKey: policy.policyKey,
        domain: policy.domain,
        tableName: policy.tableName ?? null,
        action: policy.action,
        retentionDays: policy.retentionDays,
        immutableProtected: policy.immutableProtected,
        legalHoldBlocked: decision.legalHoldBlocked || !decision.approved,
        candidateCount
      });
    }

    const reportKey = this.makeReportKey(items, policyVersion, dryRun);
    return {
      reportKey,
      generatedAt: new Date().toISOString(),
      dryRun,
      policyVersion,
      items,
      totals: {
        candidateCount: items.reduce((sum, item) => sum + item.candidateCount, 0),
        blockedCount: items.filter((item) => item.legalHoldBlocked).length,
        immutableProtectedCount: items.filter((item) => item.immutableProtected).length
      }
    };
  }

  async executeCleanup(input?: {
    domain?: string | null;
    policyKey?: string | null;
    actorType?: AccessActorType;
    actorId?: string | null;
    serviceIdentityId?: string | null;
    dryRun?: boolean;
  }) {
    const dryRun = input?.dryRun ?? true;
    const report = await this.generateCleanupReport({
      domain: input?.domain ?? null,
      policyKey: input?.policyKey ?? null,
      dryRun
    });

    if (!this.isCleanupEnabled()) {
      return {
        executed: false,
        reason: "retention_cleanup_disabled",
        report
      };
    }

    let deletedTotal = 0;
    let anonymizedTotal = 0;
    const actions: Array<{
      policyKey: string;
      deleted: number;
      anonymized: number;
      blocked: boolean;
      reason: string;
    }> = [];

    for (const item of report.items) {
      if (item.legalHoldBlocked || item.immutableProtected || item.candidateCount === 0 || dryRun) {
        actions.push({
          policyKey: item.policyKey,
          deleted: 0,
          anonymized: 0,
          blocked: item.legalHoldBlocked || item.immutableProtected,
          reason: item.immutableProtected ? "immutable_protected" : item.legalHoldBlocked ? "policy_blocked" : "dry_run_or_empty"
        });
        continue;
      }

      const policy = await this.prisma.retentionPolicy.findUnique({
        where: { policyKey: item.policyKey }
      });
      if (!policy) {
        actions.push({
          policyKey: item.policyKey,
          deleted: 0,
          anonymized: 0,
          blocked: true,
          reason: "policy_not_found"
        });
        continue;
      }

      const cutoff = new Date(Date.now() - Math.max(1, policy.retentionDays) * 24 * 60 * 60 * 1000);
      const result = await this.executeCleanupForPolicy(policy, cutoff);
      deletedTotal += result.deleted;
      anonymizedTotal += result.anonymized;
      actions.push({
        policyKey: item.policyKey,
        deleted: result.deleted,
        anonymized: result.anonymized,
        blocked: false,
        reason: "executed"
      });
    }

    await this.securityEventService.emitAuditEvent({
      actorType: input?.actorType ?? AccessActorType.SYSTEM,
      actorId: input?.actorId ?? null,
      serviceIdentityId: input?.serviceIdentityId ?? null,
      action: dryRun ? "compliance.retention.cleanup_dry_run" : "compliance.retention.cleanup_execute",
      resourceType: "retention_policy",
      reason: "retention_cleanup",
      severity: SecurityEventSeverity.HIGH,
      metadata: {
        reportKey: report.reportKey,
        deletedTotal,
        anonymizedTotal,
        dryRun,
        actions
      }
    });

    return {
      executed: !dryRun,
      report,
      deletedTotal,
      anonymizedTotal,
      actions
    };
  }
}
