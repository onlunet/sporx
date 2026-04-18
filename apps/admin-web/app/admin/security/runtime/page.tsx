import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Runtime Hardening Status"
      subtitle="Startup hardening report and critical checks"
      endpoint="/api/v1/admin/security/phase4/runtime-status"
      emptyText="Runtime hardening raporu bulunamadı."
      insight="Prod için kritik FAIL kayıtları deployment öncesi kapatılmalıdır."
    />
  );
}
