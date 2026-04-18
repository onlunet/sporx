import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Environment Hardening Checks"
      subtitle="Policy matrix and startup checks by environment"
      endpoint="/api/v1/admin/security/phase4/environment-checks"
      emptyText="Environment hardening check verisi bulunamadı."
    />
  );
}
