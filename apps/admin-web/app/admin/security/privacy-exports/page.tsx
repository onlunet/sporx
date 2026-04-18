import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import { adminSecurityComplianceEndpoints, getCompliancePrivacyExportJobs } from "../../_lib/admin-api";

function toItemsResult(result: Awaited<ReturnType<typeof getCompliancePrivacyExportJobs>>) {
  const payload = result.data;
  const items =
    result.ok &&
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    Array.isArray((payload as { items?: unknown[] }).items)
      ? (payload as { items: unknown[] }).items
      : null;

  return {
    ...result,
    data: items ?? payload
  };
}

export default async function Page() {
  const result = toItemsResult(await getCompliancePrivacyExportJobs());

  return (
    <AdminEndpointPage
      title="Privacy Export Tracker"
      subtitle="Export jobs, status progression, and completion metadata"
      endpoint={adminSecurityComplianceEndpoints.privacyExportJobs}
      result={result}
      emptyText="Privacy export job kaydi bulunamadi."
      columns={[
        { key: "id", label: "Job" },
        { key: "requestId", label: "Request" },
        { key: "userId", label: "User" },
        { key: "status", label: "Status" },
        { key: "dryRun", label: "Dry Run" },
        { key: "outputRef", label: "Output Ref" },
        { key: "errorMessage", label: "Error" },
        { key: "createdAt", label: "Created" },
        { key: "completedAt", label: "Completed" }
      ]}
      insight="Export flow should remain auditable from request creation to artifact delivery."
    />
  );
}
