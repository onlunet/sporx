import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Düşük Güvenli Tahminler"
      subtitle="Düşük güven puanlı tahmin listesi"
      endpoint="/api/v1/admin/predictions/low-confidence"
      emptyText="Düşük güvenli tahmin kaydı yok."
      insight="Bu tahminler operasyonel risk taşır. Risk bayrakları ve kaçınma nedenini birlikte inceleyin."
      columns={[
        { key: "matchId", label: "Maç Ref." },
        { key: "confidenceScore", label: "Güven Skoru" },
        { key: "summary", label: "Özet" },
        { key: "riskFlags", label: "Risk Bayrakları" },
        { key: "avoidReason", label: "Kaçınma Nedeni" },
        { key: "isRecommended", label: "Önerildi mi" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
