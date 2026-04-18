import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import { adminSecurityComplianceEndpoints, getComplianceLegalHoldIndicators } from "../../_lib/admin-api";

export default async function Page() {
  const result = await getComplianceLegalHoldIndicators();

  return (
    <AdminEndpointPage
      title="Legal-Hold Block Indicators"
      subtitle="Domains and scopes currently blocked by legal-hold hooks"
      endpoint={adminSecurityComplianceEndpoints.legalHoldIndicators}
      result={result}
      emptyText="Aktif legal-hold blok kaydi bulunamadi."
      insight="Legal-hold indicators should be visible before retention/deletion execution attempts."
    />
  );
}
