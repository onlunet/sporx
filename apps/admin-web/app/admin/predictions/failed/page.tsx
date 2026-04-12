import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Başarısız Tahminler"
      subtitle="Tahminin neden kaçtığını açıklayan analiz kayıtları"
      endpoint="/api/v1/admin/predictions/failed"
      emptyText="Başarısız tahmin kaydı yok."
      insight="Bu ekranda tahmin hatalarının kök nedeni, model etkisi ve önerilen aksiyonlar sade bir dille gösterilir."
      columns={[
        { key: "predictionId", label: "Tahmin Ref." },
        { key: "issueCategory", label: "Sorun Tipi" },
        { key: "analysis", label: "Neden / Etki" },
        { key: "actionItems", label: "Önerilen Aksiyon" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
