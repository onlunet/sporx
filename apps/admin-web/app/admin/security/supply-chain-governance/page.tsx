import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import {
  AdminApiResult,
  adminSecurityComplianceEndpoints,
  getComplianceSupplyChainGovernanceHistory,
  getPhase4ReleaseAttestations,
  getPhase4Vulnerabilities
} from "../../_lib/admin-api";

function toObjectArray(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function toFallbackGovernanceHistory(
  vulnerabilities: AdminApiResult<unknown[]>,
  attestations: AdminApiResult<unknown[]>
): AdminApiResult<unknown> {
  const vulnerabilityRows = toObjectArray(vulnerabilities.data).map((row) => ({
    source: "vulnerability",
    recordId: row.id ?? row.findingId ?? "-",
    reference: row.packageName ?? row.dependencyName ?? row.cveId ?? row.title ?? "-",
    severity: row.severity ?? "-",
    status: row.status ?? row.lifecycleStatus ?? "-",
    reason: row.ignoreReason ?? row.reason ?? "-",
    expiry: row.ignoreExpiresAt ?? row.expiryAt ?? "-",
    updatedAt: row.updatedAt ?? row.createdAt ?? "-"
  }));

  const attestationRows = toObjectArray(attestations.data).map((row) => ({
    source: "release_attestation",
    recordId: row.id ?? row.gitSha ?? "-",
    reference: row.dependencySnapshotId ?? row.scanRunId ?? row.environment ?? "-",
    severity: "-",
    status: row.status ?? "attested",
    reason: row.buildTime ?? row.environment ?? "-",
    expiry: "-",
    updatedAt: row.createdAt ?? row.updatedAt ?? "-"
  }));

  if (vulnerabilityRows.length === 0 && attestationRows.length === 0) {
    return {
      ok: false,
      status: 404,
      data: null,
      error: "Supply-chain governance verisi bulunamadi."
    };
  }

  return {
    ok: true,
    status: 200,
    data: [...vulnerabilityRows, ...attestationRows],
    error: null
  };
}

function toGovernanceRows(result: AdminApiResult<unknown>): AdminApiResult<unknown> {
  if (!result.ok || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
    return result;
  }

  const data = result.data as Record<string, unknown>;
  const vulnerabilities = toObjectArray(data.vulnerabilityDashboard);
  const releaseAttestations = toObjectArray(data.releaseAttestations);

  const rows = [
    ...vulnerabilities.map((row) => ({
      source: "vulnerability",
      recordId: row.id ?? row.findingId ?? "-",
      reference: row.packageName ?? row.dependencyName ?? row.cveId ?? row.title ?? "-",
      severity: row.severity ?? "-",
      status: row.status ?? row.disposition ?? "-",
      reason: row.ignoreReason ?? row.reason ?? "-",
      expiry: row.ignoreExpiresAt ?? row.expiryAt ?? "-",
      updatedAt: row.updatedAt ?? row.createdAt ?? "-"
    })),
    ...releaseAttestations.map((row) => ({
      source: "release_attestation",
      recordId: row.id ?? row.gitSha ?? "-",
      reference: row.dependencySnapshotId ?? row.scanRunId ?? row.environment ?? "-",
      severity: row.scanStatus ?? "-",
      status: row.environment ?? "-",
      reason: row.buildTime ?? "-",
      expiry: "-",
      updatedAt: row.createdAt ?? row.updatedAt ?? "-"
    }))
  ];

  return {
    ...result,
    data: rows
  };
}

export default async function Page() {
  let result = toGovernanceRows(await getComplianceSupplyChainGovernanceHistory());

  if (!result.ok && result.status === 404) {
    const [vulnerabilities, attestations] = await Promise.all([
      getPhase4Vulnerabilities(),
      getPhase4ReleaseAttestations()
    ]);
    result = toFallbackGovernanceHistory(vulnerabilities, attestations);
  }

  return (
    <AdminEndpointPage
      title="Supply-Chain / Release Governance History"
      subtitle="Historical vulnerability, ignore-with-expiry, and release lineage visibility"
      endpoint={adminSecurityComplianceEndpoints.supplyChainGovernanceHistory}
      result={result}
      emptyText="Supply-chain governance history kaydi bulunamadi."
      columns={[
        { key: "source", label: "Source" },
        { key: "recordId", label: "Record" },
        { key: "reference", label: "Reference" },
        { key: "severity", label: "Severity" },
        { key: "status", label: "Status" },
        { key: "reason", label: "Reason" },
        { key: "expiry", label: "Expiry" },
        { key: "updatedAt", label: "Updated" }
      ]}
      insight="Ignored findings should always carry reason and expiry; release lineage should remain queryable over time."
    />
  );
}
