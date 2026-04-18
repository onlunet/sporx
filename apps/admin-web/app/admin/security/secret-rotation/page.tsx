import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Secret Rotation Metadata"
      subtitle="Secret lifecycle metadata and rotation trail"
      endpoint="/api/v1/admin/security/phase4/secret-rotations"
      emptyText="Henüz secret rotation kaydı yok."
      columns={[
        { key: "category", label: "Kategori" },
        { key: "secretRef", label: "Secret Ref" },
        { key: "lifecycleStatus", label: "Lifecycle" },
        { key: "reason", label: "Neden" },
        { key: "environment", label: "Ortam" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
