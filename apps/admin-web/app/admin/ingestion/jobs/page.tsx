import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="İçe Aktarım İşleri"
      subtitle="Ingestion job çalışma geçmişi"
      endpoint="/api/v1/admin/ingestion/jobs"
      emptyText="Henüz ingestion job kaydı yok."
      insight="Her job için okuma-yazma adetleri ve hata sayısı birlikte değerlendirilmelidir."
      columns={[
        { key: "jobType", label: "İş Tipi" },
        { key: "status", label: "Durum" },
        { key: "recordsRead", label: "Okunan" },
        { key: "recordsWritten", label: "Yazılan" },
        { key: "errors", label: "Hata" },
        { key: "logs", label: "Detay" },
        { key: "startedAt", label: "Başlangıç" },
        { key: "finishedAt", label: "Bitiş" }
      ]}
    />
  );
}
