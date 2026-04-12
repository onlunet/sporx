import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Özellik Laboratuvarı"
      subtitle="Feature set ve deney setleri"
      endpoint="/api/v1/admin/features/lab"
      emptyText="Henüz feature lab seti yok."
      insight="Her feature set için bağlı deneyleri ve açıklamasını tek ekranda takip edebilirsiniz."
      columns={[
        { key: "name", label: "Set Adı" },
        { key: "description", label: "Açıklama" },
        { key: "experiments", label: "Deneyler" },
        { key: "createdAt", label: "Oluşturulma" }
      ]}
    />
  );
}
