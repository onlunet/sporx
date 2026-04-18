import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Dependency Vulnerability Dashboard"
      subtitle="Open/ignored/resolved vulnerability findings"
      endpoint="/api/v1/admin/security/phase4/vulnerabilities"
      emptyText="Vulnerability finding yok."
      insight="Ignore kayıtları mutlaka expiry ve reason ile tutulmalıdır."
    />
  );
}
