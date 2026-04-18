import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import {
  adminSecurityComplianceEndpoints,
  getComplianceRetentionPolicies
} from "../../_lib/admin-api";

export default async function Page() {
  const result = await getComplianceRetentionPolicies();

  return (
    <AdminEndpointPage
      title="Retention Policy Viewer"
      subtitle="Policy-driven retention windows and cleanup actions"
      endpoint={adminSecurityComplianceEndpoints.retentionPolicies}
      result={result}
      emptyText="Retention policy kaydi bulunamadi."
      columns={[
        { key: "policyKey", label: "Policy Key" },
        { key: "domain", label: "Domain" },
        { key: "tableName", label: "Table" },
        { key: "dataClass", label: "Data Class" },
        { key: "retentionDays", label: "Retention Days" },
        { key: "action", label: "Action" },
        { key: "legalHoldBlockable", label: "Legal Hold Aware" },
        { key: "immutableProtected", label: "Immutable Protected" },
        { key: "policyVersion", label: "Policy Version" },
        { key: "updatedAt", label: "Updated" }
      ]}
      insight="Dry-run output should be reviewed before execute mode in destructive cleanup operations."
    />
  );
}
