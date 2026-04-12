import { AdminEndpointPage } from "../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Kullanıcılar"
      subtitle="Yönetim kullanıcı listesi"
      endpoint="/api/v1/admin/users"
      emptyText="Henüz kullanıcı kaydı yok."
      insight="Kullanıcı aktivasyonu ve rol dağılımı güvenlik açısından kritik. Gereksiz yetkileri düzenli temizleyin."
      columns={[
        { key: "email", label: "E-posta" },
        { key: "role.name", label: "Rol" },
        { key: "isActive", label: "Aktif" },
        { key: "createdAt", label: "Oluşturulma" }
      ]}
    />
  );
}
