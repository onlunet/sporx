import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import { adminSecurityComplianceEndpoints, getComplianceActionAudit } from "../../_lib/admin-api";

export default async function Page() {
  const result = await getComplianceActionAudit();

  return (
    <AdminEndpointPage
      title="Compliance Action Audit Explorer"
      subtitle="Policy decisions and governance action timeline"
      endpoint={adminSecurityComplianceEndpoints.complianceActionAudit}
      result={result}
      emptyText="Compliance action audit kaydi bulunamadi."
      columns={[
        { key: "id", label: "Event" },
        { key: "action", label: "Action" },
        { key: "decisionResult", label: "Decision" },
        { key: "actorType", label: "Actor Type" },
        { key: "actorId", label: "Actor" },
        { key: "resourceType", label: "Resource Type" },
        { key: "policyVersionId", label: "Policy Version" },
        { key: "createdAt", label: "Created" }
      ]}
      insight="Governance actions should always be linked to immutable audit and policy version metadata."
    />
  );
}
