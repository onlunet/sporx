import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { IngestScanRunInput, IngestVulnerabilityInput } from "./security-hardening.types";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { SecurityScanRunStatus, VulnerabilityDisposition, VulnerabilitySeverity } from "@prisma/client";

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
export class SupplyChainSecurityService {
  constructor(private readonly prisma: PrismaService) {}

  isVulnerabilityGateEnabled() {
    return parseBoolean(process.env.VULNERABILITY_GATE_ENABLED, true);
  }

  private resolveEnvironment() {
    return clean(process.env.APP_ENV) ?? clean(process.env.NODE_ENV) ?? "development";
  }

  private findWorkspaceRoot() {
    const candidates = [process.cwd(), resolve(process.cwd(), ".."), resolve(process.cwd(), "../.."), resolve(process.cwd(), "../../..")];
    for (const candidate of candidates) {
      const packageJsonPath = join(candidate, "package.json");
      if (!existsSync(packageJsonPath)) {
        continue;
      }
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { workspaces?: unknown };
        if (parsed.workspaces) {
          return candidate;
        }
      } catch {
        // noop
      }
    }
    return process.cwd();
  }

  private hash(value: string) {
    return createHash("sha256").update(value).digest("hex");
  }

  async captureDependencyInventorySnapshot(scope = "monorepo") {
    const workspaceRoot = this.findWorkspaceRoot();
    const lockfilePath = join(workspaceRoot, "package-lock.json");
    const manifestPath = join(workspaceRoot, "package.json");

    const packages: Array<{ name: string; version: string }> = [];
    let lockfileHash: string | null = null;

    if (existsSync(lockfilePath)) {
      const raw = readFileSync(lockfilePath, "utf8");
      lockfileHash = this.hash(raw);
      try {
        const parsed = JSON.parse(raw) as {
          packages?: Record<string, { version?: string }>;
          dependencies?: Record<string, { version?: string }>;
        };

        if (parsed.packages) {
          for (const [key, value] of Object.entries(parsed.packages)) {
            if (!key.startsWith("node_modules/")) {
              continue;
            }
            const name = key.replace(/^node_modules\//, "");
            const version = value.version ?? "unknown";
            packages.push({ name, version });
          }
        } else if (parsed.dependencies) {
          for (const [name, value] of Object.entries(parsed.dependencies)) {
            packages.push({ name, version: value.version ?? "unknown" });
          }
        }
      } catch {
        // parse failure falls back to empty list
      }
    }

    const snapshotKey = this.hash(`${scope}:${lockfileHash ?? "no-lockfile"}`);
    return this.prisma.dependencyInventorySnapshot.upsert({
      where: { snapshotKey },
      update: {
        packageCount: packages.length,
        packagesJson: packages as any,
        environment: this.resolveEnvironment(),
        metadata: {
          workspaceRoot,
          lockfilePath: existsSync(lockfilePath) ? lockfilePath : null
        } as any
      },
      create: {
        snapshotKey,
        scope,
        manifestPath: existsSync(manifestPath) ? manifestPath : null,
        lockfileHash,
        packageCount: packages.length,
        packagesJson: packages as any,
        environment: this.resolveEnvironment(),
        metadata: {
          workspaceRoot,
          lockfilePath: existsSync(lockfilePath) ? lockfilePath : null
        } as any
      }
    });
  }

  async ingestScanRun(input: IngestScanRunInput) {
    const runKey = clean(input.runKey);
    if (runKey) {
      const existing = await this.prisma.securityScanRun.findUnique({ where: { runKey } });
      if (existing) {
        return existing;
      }
    }

    return this.prisma.securityScanRun.create({
      data: {
        runKey,
        source: input.source.trim(),
        status: input.status ?? SecurityScanRunStatus.COMPLETED,
        startedAt: input.startedAt ?? null,
        completedAt: input.completedAt ?? null,
        summary: (input.summary ?? null) as any,
        environment: clean(input.environment) ?? this.resolveEnvironment(),
        metadata: (input.metadata ?? null) as any
      }
    });
  }

  async ingestVulnerabilityFinding(input: IngestVulnerabilityInput) {
    const normalizedFindingKey =
      clean(input.findingKey) ??
      this.hash(
        [
          input.packageName.trim().toLowerCase(),
          input.packageVersion.trim().toLowerCase(),
          clean(input.advisoryId)?.toLowerCase() ?? "",
          input.severity,
          input.title.trim().toLowerCase()
        ].join(":")
      );

    const existing = await this.prisma.vulnerabilityFinding.findUnique({
      where: { findingKey: normalizedFindingKey }
    });

    if (existing) {
      return this.prisma.vulnerabilityFinding.update({
        where: { id: existing.id },
        data: {
          scanRunId: clean(input.scanRunId) ?? existing.scanRunId,
          packageVersion: input.packageVersion.trim(),
          severity: input.severity,
          title: input.title.trim(),
          description: input.description ?? null,
          fixedVersion: input.fixedVersion ?? null,
          cvssScore: input.cvssScore ?? null,
          disposition: input.disposition ?? existing.disposition,
          environment: clean(input.environment) ?? existing.environment,
          metadata: (input.metadata ?? existing.metadata ?? null) as any
        }
      });
    }

    return this.prisma.vulnerabilityFinding.create({
      data: {
        findingKey: normalizedFindingKey,
        scanRunId: clean(input.scanRunId) ?? null,
        packageName: input.packageName.trim(),
        packageVersion: input.packageVersion.trim(),
        advisoryId: clean(input.advisoryId) ?? null,
        severity: input.severity,
        title: input.title.trim(),
        description: input.description ?? null,
        fixedVersion: input.fixedVersion ?? null,
        cvssScore: input.cvssScore ?? null,
        disposition: input.disposition ?? VulnerabilityDisposition.OPEN,
        environment: clean(input.environment) ?? this.resolveEnvironment(),
        metadata: (input.metadata ?? null) as any
      }
    });
  }

  async ignoreFindingWithExpiry(input: {
    findingId: string;
    reason: string;
    expiresAt?: Date | null;
  }) {
    return this.prisma.vulnerabilityFinding.update({
      where: { id: input.findingId },
      data: {
        disposition: VulnerabilityDisposition.IGNORED,
        ignoreReason: input.reason.trim(),
        ignoreExpiresAt: input.expiresAt ?? null
      }
    });
  }

  isIgnoreActive(finding: {
    disposition: VulnerabilityDisposition;
    ignoreExpiresAt: Date | null;
  }) {
    if (finding.disposition !== VulnerabilityDisposition.IGNORED) {
      return false;
    }
    if (!finding.ignoreExpiresAt) {
      return true;
    }
    return finding.ignoreExpiresAt.getTime() > Date.now();
  }

  async listVulnerabilityDashboard(limit = 300) {
    const findings = await this.prisma.vulnerabilityFinding.findMany({
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: Math.max(1, Math.min(limit, 2000))
    });

    const activeOpen = findings.filter((item) => {
      if (item.disposition === VulnerabilityDisposition.RESOLVED) {
        return false;
      }
      if (item.disposition === VulnerabilityDisposition.IGNORED) {
        return !this.isIgnoreActive(item);
      }
      return true;
    });

    const counts: Record<VulnerabilitySeverity, number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0
    };
    for (const finding of activeOpen) {
      counts[finding.severity] += 1;
    }

    return {
      findings,
      summary: {
        total: findings.length,
        activeOpen: activeOpen.length,
        counts
      }
    };
  }

  async evaluateVulnerabilityGate(input?: {
    warnThreshold?: VulnerabilitySeverity;
    failThreshold?: VulnerabilitySeverity;
  }) {
    const dashboard = await this.listVulnerabilityDashboard(2000);
    const warnAt = input?.warnThreshold ?? VulnerabilitySeverity.HIGH;
    const failAt = input?.failThreshold ?? VulnerabilitySeverity.CRITICAL;

    const ordered: VulnerabilitySeverity[] = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const warnIndex = ordered.indexOf(warnAt);
    const failIndex = ordered.indexOf(failAt);

    const warnCount = ordered
      .slice(warnIndex)
      .reduce((acc, level) => acc + dashboard.summary.counts[level], 0);
    const failCount = ordered
      .slice(failIndex)
      .reduce((acc, level) => acc + dashboard.summary.counts[level], 0);

    return {
      enabled: this.isVulnerabilityGateEnabled(),
      warnAt,
      failAt,
      warnCount,
      failCount,
      shouldWarn: warnCount > 0,
      shouldFail: this.isVulnerabilityGateEnabled() ? failCount > 0 : false,
      counts: dashboard.summary.counts
    };
  }
}
