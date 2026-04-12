import { AdminEndpointPage } from "../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Geri Test"
      subtitle="Model geri test çalışmaları ve sonuçları"
      endpoint="/api/v1/admin/backtest/results"
      emptyText="Henüz geri test sonucu yok."
      insight="Bu ekran modelin geçmiş veri üzerindeki performansını gösterir. Aralık ve metrik birlikte yorumlanmalıdır."
      columns={[
        { key: "modelVersionId", label: "Model Sürümü" },
        { key: "rangeStart", label: "Başlangıç" },
        { key: "rangeEnd", label: "Bitiş" },
        { key: "metrics", label: "Metrikler" },
        { key: "summary", label: "Özet" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
