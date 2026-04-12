import { AdminEndpointPage } from "../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Yedekleme"
      subtitle="Yedekleme ve senkronizasyon ayarları"
      endpoint="/api/v1/admin/system/settings"
      emptyText="Henüz sistem ayarı bulunamadı."
      insight="Yedekleme ile ilgili anahtarlar burada tutulur. Değişiklikten önce mevcut değerleri not edin."
      columns={[
        { key: "key", label: "Ayar Anahtarı" },
        { key: "value", label: "Ayar Değeri" },
        { key: "description", label: "Açıklama" },
        { key: "updatedAt", label: "Güncelleme" }
      ]}
    />
  );
}
