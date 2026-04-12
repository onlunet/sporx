import { AdminEndpointPage } from "../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Kalibrasyon"
      subtitle="Kalibrasyon sonuçları"
      endpoint="/api/v1/admin/calibration/results"
      emptyText="Henüz kalibrasyon kaydı yok."
      insight="Kalibrasyon skoru model olasılıklarının ne kadar güvenilir olduğunu gösterir. Brier ve ECE düşük olmalıdır."
      columns={[
        { key: "modelVersionId", label: "Model Sürümü" },
        { key: "brierScore", label: "Brier Skoru" },
        { key: "ece", label: "ECE" },
        { key: "bucketReport", label: "Kova Raporu" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
