import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Model Stratejileri"
      subtitle="Aktif ve geçmiş stratejiler"
      endpoint="/api/v1/admin/models/strategies"
      emptyText="Henüz model stratejisi yok."
      insight="Aktif strateji ve konfigürasyon değişiklikleri tahmin davranışını belirler. Not alanı operasyonel kararları özetler."
      columns={[
        { key: "name", label: "Strateji" },
        { key: "isActive", label: "Aktif" },
        { key: "notes", label: "Not" },
        { key: "config", label: "Konfigürasyon" },
        { key: "updatedAt", label: "Güncelleme" },
        { key: "createdAt", label: "Oluşturulma" }
      ]}
    />
  );
}
