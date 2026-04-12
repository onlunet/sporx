import { AdminEndpointPage } from "../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Modeller"
      subtitle="Model envanteri ve kullanım durumu"
      endpoint="/api/v1/admin/models"
      emptyText="Model kaydı bulunamadı."
      insight="Bu ekran tahmin üretiminde kullanılan tüm model sürümlerini, kullanım sayısını ve performans metriklerini tek tabloda gösterir."
      columns={[
        { key: "modelLabel", label: "Model" },
        { key: "active", label: "Aktif" },
        { key: "usageStatus", label: "Kullanım" },
        { key: "predictionCount", label: "Tahmin Sayısı" },
        { key: "trainingWindow", label: "Eğitim Aralığı" },
        { key: "accuracy", label: "Doğruluk" },
        { key: "brier", label: "Brier" },
        { key: "logLoss", label: "LogLoss" },
        { key: "lastMeasuredAt", label: "Son Ölçüm" },
        { key: "comparisonCount", label: "Karşılaştırma Kayıt" },
        { key: "source", label: "Kayıt Türü" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
