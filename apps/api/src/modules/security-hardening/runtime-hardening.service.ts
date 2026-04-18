import { Injectable } from "@nestjs/common";
import { AccessActorType, SecurityEventSeverity, SecurityEventSourceDomain } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SecurityEventService } from "../security-events/security-event.service";
import { APISecurityService } from "./api-security.service";
import { RuntimeHardeningReport } from "./security-hardening.types";
import { SecretGovernanceService } from "./secret-governance.service";

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

@Injectable()
export class RuntimeHardeningService {
  private latestReport: RuntimeHardeningReport | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly secretGovernanceService: SecretGovernanceService,
    private readonly apiSecurityService: APISecurityService,
    private readonly securityEventService: SecurityEventService
  ) {}

  isEnabled() {
    return parseBoolean(process.env.RUNTIME_HARDENING_CHECKS_ENABLED, true);
  }

  private resolveEnvironment() {
    const env = process.env.APP_ENV?.trim() || process.env.NODE_ENV?.trim() || "development";
    if (env === "production" || env === "staging") {
      return env;
    }
    return "development";
  }

  private parseTtlSeconds(value: string | undefined, fallback: number) {
    if (!value) {
      return fallback;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized.endsWith("m")) {
      const amount = Number.parseInt(normalized.slice(0, -1), 10);
      return Number.isFinite(amount) ? amount * 60 : fallback;
    }
    if (normalized.endsWith("h")) {
      const amount = Number.parseInt(normalized.slice(0, -1), 10);
      return Number.isFinite(amount) ? amount * 3600 : fallback;
    }
    const amount = Number.parseInt(normalized, 10);
    return Number.isFinite(amount) ? amount : fallback;
  }

  runStartupChecks(): RuntimeHardeningReport {
    const environment = this.resolveEnvironment();
    const checks: RuntimeHardeningReport["checks"] = [];

    const secretCheck = this.secretGovernanceService.validateRequiredSecrets(environment);
    checks.push({
      key: "required_secrets_present",
      status: secretCheck.missingSecrets.length === 0 ? "PASS" : "FAIL",
      detail:
        secretCheck.missingSecrets.length === 0
          ? "Required secrets are configured."
          : `Missing: ${secretCheck.missingSecrets.join(", ")}`
    });

    checks.push({
      key: "secret_strength",
      status: secretCheck.insecureSecrets.length === 0 ? "PASS" : "FAIL",
      detail:
        secretCheck.insecureSecrets.length === 0
          ? "Secret strength checks passed."
          : secretCheck.insecureSecrets.join("; ")
    });

    const corsCheck = this.apiSecurityService.validateCorsPolicyForEnvironment(environment);
    checks.push({
      key: "cors_policy",
      status: corsCheck.ok ? "PASS" : "FAIL",
      detail: corsCheck.ok ? "CORS policy is restrictive enough." : corsCheck.issues.join("; ")
    });

    if (environment === "production") {
      const trustProxy = parseBoolean(process.env.TRUST_PROXY, true);
      checks.push({
        key: "trust_proxy",
        status: trustProxy ? "PASS" : "WARN",
        detail: trustProxy ? "TRUST_PROXY enabled." : "TRUST_PROXY disabled in production."
      });

      const debugEnabled = parseBoolean(process.env.DEBUG, false);
      checks.push({
        key: "debug_mode",
        status: debugEnabled ? "FAIL" : "PASS",
        detail: debugEnabled ? "DEBUG mode must be disabled in production." : "Debug mode is disabled."
      });

      const accessTtl = this.parseTtlSeconds(process.env.JWT_ACCESS_TTL, 15 * 60);
      checks.push({
        key: "access_token_ttl",
        status: accessTtl <= 60 * 60 ? "PASS" : "WARN",
        detail: accessTtl <= 60 * 60 ? "Access token TTL is within hardened bounds." : "Access token TTL exceeds 1 hour."
      });

      checks.push({
        key: "security_headers_enabled",
        status: this.apiSecurityService.isStrictSecurityHeadersEnabled() ? "PASS" : "FAIL",
        detail: this.apiSecurityService.isStrictSecurityHeadersEnabled()
          ? "Strict security headers enabled."
          : "STRICT_SECURITY_HEADERS_ENABLED is disabled."
      });
    }

    const failedCritical = checks.some((check) => check.status === "FAIL");
    const report: RuntimeHardeningReport = {
      environment,
      generatedAt: new Date().toISOString(),
      checks,
      failedCritical
    };
    this.latestReport = report;
    return report;
  }

  async assertStartupHardeningOrThrow() {
    if (!this.isEnabled()) {
      return;
    }

    const report = this.runStartupChecks();
    if (!report.failedCritical) {
      return;
    }

    await this.securityEventService.emitSecurityEvent({
      sourceDomain: SecurityEventSourceDomain.RUNTIME,
      eventType: "runtime_hardening_startup_failed",
      severity: SecurityEventSeverity.CRITICAL,
      actorType: AccessActorType.SYSTEM,
      reason: "critical_startup_hardening_check_failed",
      metadata: {
        environment: report.environment,
        failedChecks: report.checks.filter((item) => item.status === "FAIL")
      }
    });

    throw new Error(
      `Runtime hardening startup checks failed: ${report.checks
        .filter((item) => item.status === "FAIL")
        .map((item) => item.key)
        .join(", ")}`
    );
  }

  getLatestStartupReport() {
    if (!this.latestReport) {
      return this.runStartupChecks();
    }
    return this.latestReport;
  }

  async createReleaseAttestation(input: {
    attestationKey?: string | null;
    gitSha: string;
    buildTime: Date;
    environment?: string;
    dependencySnapshotId?: string | null;
    scanRunId?: string | null;
    metadata?: Record<string, unknown> | null;
  }) {
    const environment = input.environment?.trim() || this.resolveEnvironment();
    return this.prisma.releaseAttestation.upsert({
      where: {
        attestationKey: input.attestationKey?.trim() || `${input.gitSha}:${environment}:${input.buildTime.toISOString()}`
      },
      update: {
        dependencySnapshotId: input.dependencySnapshotId ?? null,
        scanRunId: input.scanRunId ?? null,
        metadata: (input.metadata ?? null) as any
      },
      create: {
        attestationKey: input.attestationKey?.trim() || `${input.gitSha}:${environment}:${input.buildTime.toISOString()}`,
        gitSha: input.gitSha.trim(),
        buildTime: input.buildTime,
        environment,
        dependencySnapshotId: input.dependencySnapshotId ?? null,
        scanRunId: input.scanRunId ?? null,
        metadata: (input.metadata ?? null) as any
      }
    });
  }

  listReleaseAttestations(limit = 200) {
    return this.prisma.releaseAttestation.findMany({
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(limit, 2000))
    });
  }
}
