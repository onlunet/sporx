import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import {
  adminSecurityComplianceEndpoints,
  getComplianceDataClassifications
} from "../../_lib/admin-api";

export default async function Page() {
  const result = await getComplianceDataClassifications();

  return (
    <AdminEndpointPage
      title="Data Classification Viewer"
      subtitle="Domain and table/field classification metadata"
      endpoint={adminSecurityComplianceEndpoints.dataClassifications}
      result={result}
      emptyText="Data classification kaydi bulunamadi."
      columns={[
        { key: "domain", label: "Domain" },
        { key: "entity", label: "Entity" },
        { key: "fieldName", label: "Field" },
        { key: "dataClass", label: "Class" },
        { key: "redactionStrategy", label: "Redaction" },
        { key: "policyVersion", label: "Policy Version" },
        { key: "updatedAt", label: "Updated" }
      ]}
      insight="Classification metadata should stay explicit and be used by redaction/minimization controls."
    />
  );
}
