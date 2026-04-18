import { VulnerabilityDisposition, VulnerabilitySeverity } from "@prisma/client";
import { SupplyChainSecurityService } from "./supply-chain-security.service";

describe("SupplyChainSecurityService", () => {
  function createService(findings: any[]) {
    const prisma = {
      dependencyInventorySnapshot: {
        upsert: jest.fn()
      },
      securityScanRun: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn()
      },
      vulnerabilityFinding: {
        findUnique: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn().mockResolvedValue(findings)
      }
    } as any;
    return new SupplyChainSecurityService(prisma);
  }

  it("treats ignore with future expiry as active ignore", () => {
    const service = createService([]);
    const future = new Date(Date.now() + 10_000);
    expect(
      service.isIgnoreActive({
        disposition: VulnerabilityDisposition.IGNORED,
        ignoreExpiresAt: future
      })
    ).toBe(true);
  });

  it("counts expired ignored findings as active open risk", async () => {
    const service = createService([
      {
        disposition: VulnerabilityDisposition.IGNORED,
        ignoreExpiresAt: new Date(Date.now() - 60_000),
        severity: VulnerabilitySeverity.HIGH
      },
      {
        disposition: VulnerabilityDisposition.OPEN,
        ignoreExpiresAt: null,
        severity: VulnerabilitySeverity.CRITICAL
      }
    ]);

    const gate = await service.evaluateVulnerabilityGate({
      warnThreshold: VulnerabilitySeverity.HIGH,
      failThreshold: VulnerabilitySeverity.CRITICAL
    });
    expect(gate.warnCount).toBe(2);
    expect(gate.failCount).toBe(1);
  });
});
