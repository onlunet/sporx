import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Geçmiş Veri Aktarımı"
      subtitle="Historical import çalışma geçmişi"
      endpoint="/api/v1/admin/import/status"
      emptyText="Henüz historical import çalışması yok."
      insight="Bu ekran CSV aktarımlarının kaç kayıt okuduğunu, kaçını birleştirdiğini ve çakışma sayısını gösterir."
      columns={[
        { key: "sourceName", label: "Kaynak" },
        { key: "status", label: "Durum" },
        { key: "recordsRead", label: "Okunan" },
        { key: "recordsMerged", label: "Birleştirilen" },
        { key: "conflicts", label: "Çakışma" },
        { key: "summary", label: "Özet" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
