import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Sapma Özeti"
      subtitle="Model drift özeti"
      endpoint="/api/v1/admin/models/drift-summary"
      emptyText="Henüz drift verisi yok."
      insight="Metrik zaman serisindeki düzenli bozulmalar veri sapmasına işaret eder. Ölçümler arası trendi birlikte okuyun."
      columns={[
        { key: "modelVersionId", label: "Model Sürümü" },
        { key: "measuredAt", label: "Ölçüm Zamanı" },
        { key: "metrics", label: "Metrikler" }
      ]}
    />
  );
}
