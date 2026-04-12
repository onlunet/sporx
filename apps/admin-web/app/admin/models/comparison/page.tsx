import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Model Karşılaştırma"
      subtitle="Model karşılaştırma snapshotları"
      endpoint="/api/v1/admin/models/comparison"
      emptyText="Henüz model karşılaştırma kaydı yok."
      insight="Model performansını yan yana izleyin: doğruluk, kalibrasyon ve güven skorunda geri düşen sürümleri burada hızlıca ayıklayın."
      columns={[
        { key: "modelLabel", label: "Model" },
        { key: "active", label: "Aktif" },
        { key: "winnerModel", label: "Kazanan Model" },
        { key: "comparedWith", label: "Karşılaştırılan" },
        { key: "source", label: "Kayıt Türü" },
        { key: "details", label: "Detay" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
