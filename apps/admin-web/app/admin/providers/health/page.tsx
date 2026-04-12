import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Sağlayıcı Sağlığı"
      subtitle="Provider health durumu"
      endpoint="/api/v1/admin/providers/health"
      emptyText="Sağlayıcı sağlık kaydı bulunamadı."
      insight="Sağlayıcı gecikmesi ve durum bilgisi veri tazeliğini doğrudan etkiler. Sorunlu sağlayıcılar önce burada görünür."
      columns={[
        { key: "provider", label: "Sağlayıcı" },
        { key: "status", label: "Durum" },
        { key: "latencyMs", label: "Gecikme (ms)" },
        { key: "message", label: "Mesaj" },
        { key: "checkedAt", label: "Kontrol Zamanı" }
      ]}
    />
  );
}
