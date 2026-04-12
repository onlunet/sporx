import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Özellik Önemi"
      subtitle="Feature importance snapshotları"
      endpoint="/api/v1/admin/models/feature-importance"
      emptyText="Henüz feature importance kaydı yok."
      insight="Tahmini en çok etkileyen değişkenleri bu ekrandan takip edin. Beklenmeyen kaymalar model drift veya veri kalitesi sorununu gösterebilir."
      columns={[
        { key: "modelVersionId", label: "Model Sürümü" },
        { key: "measuredAt", label: "Ölçüm Zamanı" },
        { key: "values", label: "Önem Değerleri" }
      ]}
    />
  );
}
