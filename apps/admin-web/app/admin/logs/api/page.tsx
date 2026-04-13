import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="API Kayıtları"
      subtitle="Son API istek kayıtları"
      endpoint="/api/v1/admin/logs/api"
      emptyText="Henüz API log kaydı yok."
      insight="Durum kodu ve süre birlikte incelenerek yavaşlayan veya hata veren endpointler tespit edilir."
      columns={[
        { key: "method", label: "Metot" },
        { key: "path", label: "Yol" },
        { key: "statusCode", label: "Durum Kodu" },
        { key: "durationMs", label: "Süre (ms)" },
        { key: "requestId", label: "İstek Ref." },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
