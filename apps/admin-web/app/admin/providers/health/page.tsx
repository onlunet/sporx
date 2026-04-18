import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import { AdminApiResult, adminApiGet } from "../../_lib/admin-api";

type ProviderHealth = {
  provider: string;
  status: string;
  latencyMs: number;
  checkedAt: string;
  message?: string;
};

type ProviderCatalogItem = {
  key: string;
  isActive: boolean;
};

function buildProviderHealthFallback(providers: ProviderCatalogItem[]): ProviderHealth[] {
  const checkedAt = new Date().toISOString();
  return providers
    .filter((provider) => provider.isActive)
    .map((provider) => ({
      provider: provider.key,
      status: "degraded",
      latencyMs: 0,
      checkedAt,
      message: "Sağlık verisi geçici olarak alınamadı."
    }));
}

export default async function Page() {
  const healthResult = await adminApiGet<ProviderHealth[]>("/api/v1/admin/providers/health");
  let result: AdminApiResult<unknown> = healthResult as AdminApiResult<unknown>;

  if (!healthResult.ok || !Array.isArray(healthResult.data) || healthResult.data.length === 0) {
    const providersResult = await adminApiGet<ProviderCatalogItem[]>("/api/v1/admin/providers");
    if (providersResult.ok && Array.isArray(providersResult.data)) {
      result = {
        ok: true,
        status: 200,
        data: buildProviderHealthFallback(providersResult.data),
        error: null
      };
    }
  }

  return (
    <AdminEndpointPage
      title="Sağlayıcı Sağlığı"
      subtitle="Provider health durumu"
      endpoint="/api/v1/admin/providers/health"
      result={result}
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
