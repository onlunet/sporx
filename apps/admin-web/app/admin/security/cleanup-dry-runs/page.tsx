import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import {
  adminSecurityComplianceEndpoints,
  getComplianceCleanupDryRunReports
} from "../../_lib/admin-api";

function toItemsResult(result: Awaited<ReturnType<typeof getComplianceCleanupDryRunReports>>) {
  const data =
    result.ok && result.data && typeof result.data === "object" && Array.isArray((result.data as { items?: unknown[] }).items)
      ? (result.data as { items: unknown[] }).items
      : null;

  return {
    ...result,
    data
  };
}

export default async function Page() {
  const result = toItemsResult(await getComplianceCleanupDryRunReports());

  return (
    <AdminEndpointPage
      title="Cleanup Dry-Run Reports"
      subtitle="Projected cleanup impact and governance checks before execution"
      endpoint={adminSecurityComplianceEndpoints.cleanupDryRunReports}
      result={result}
      emptyText="Cleanup dry-run report kaydi bulunamadi."
      columns={[
        { key: "policyKey", label: "Policy Key" },
        { key: "domain", label: "Domain" },
        { key: "tableName", label: "Table" },
        { key: "action", label: "Action" },
        { key: "retentionDays", label: "Retention Days" },
        { key: "candidateCount", label: "Candidates" },
        { key: "immutableProtected", label: "Immutable Protected" },
        { key: "legalHoldBlocked", label: "Policy Blocked" }
      ]}
      insight="Dry-run and execute outputs should remain separated and linked to policy decisions."
    />
  );
}
