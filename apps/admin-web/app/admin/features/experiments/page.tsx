import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Özellik Deneyleri"
      subtitle="Feature lab deney sonuçları"
      endpoint="/api/v1/admin/features/lab/results"
      emptyText="Henüz deney sonucu yok."
      insight="Deneylerin durumunu ve çıktısını takip ederek hangi özellik kombinasyonunun modeli iyileştirdiğini görebilirsiniz."
      columns={[
        { key: "name", label: "Deney Adı" },
        { key: "status", label: "Durum" },
        { key: "hypothesis", label: "Hipotez" },
        { key: "config", label: "Konfigürasyon" },
        { key: "result", label: "Sonuç" },
        { key: "updatedAt", label: "Güncelleme" }
      ]}
    />
  );
}
