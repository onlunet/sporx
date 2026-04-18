import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import { adminSecurityComplianceEndpoints, getComplianceDeletionRequests } from "../../_lib/admin-api";

function toItemsResult(result: Awaited<ReturnType<typeof getComplianceDeletionRequests>>) {
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
  const result = toItemsResult(await getComplianceDeletionRequests());

  return (
    <AdminEndpointPage
      title="Deletion Request Tracker"
      subtitle="Policy-checked deletion and anonymization request states"
      endpoint={adminSecurityComplianceEndpoints.deletionRequests}
      result={result}
      emptyText="Deletion request kaydi bulunamadi."
      columns={[
        { key: "id", label: "Request" },
        { key: "userId", label: "User" },
        { key: "targetDomain", label: "Target Domain" },
        { key: "targetEntity", label: "Target Entity" },
        { key: "requestType", label: "Request Type" },
        { key: "status", label: "Status" },
        { key: "reason", label: "Reason" },
        { key: "policyVersion", label: "Policy Version" },
        { key: "createdAt", label: "Created" }
      ]}
      insight="Immutable audit/security records should never be silently removed without explicit policy path."
    />
  );
}
