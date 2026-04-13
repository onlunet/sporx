import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Denetim Kayıtları"
      subtitle="Audit log geçmişi"
      endpoint="/api/v1/admin/logs/audit"
      emptyText="Henüz audit log kaydı yok."
      insight="Kritik değişikliklerde kim-ne-zaman bilgisini bu ekrandan takip edebilirsiniz."
      columns={[
        { key: "action", label: "Aksiyon" },
        { key: "resourceType", label: "Kaynak Türü" },
        { key: "resourceId", label: "Kaynak Ref." },
        { key: "diff", label: "Değişiklik" },
        { key: "metadata", label: "Ek Bilgi" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
