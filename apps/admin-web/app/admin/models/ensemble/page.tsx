import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Ansambl Yapılandırması"
      subtitle="Ensemble ayarları"
      endpoint="/api/v1/admin/models/ensemble-configs"
      emptyText="Ensemble ayarı bulunamadı."
      insight="Birden fazla modelin nasıl birleştirileceği bu ayarlardan yönetilir. Değişiklikler canlı tahmine doğrudan etki eder."
      columns={[
        { key: "key", label: "Ayar Anahtarı" },
        { key: "value", label: "Ayar Değeri" },
        { key: "description", label: "Açıklama" },
        { key: "updatedAt", label: "Güncelleme" }
      ]}
    />
  );
}
