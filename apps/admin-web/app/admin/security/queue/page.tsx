import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Queue Security Overview"
      subtitle="Queue scope posture and anomaly signals"
      endpoint="/api/v1/admin/security/phase4/queue-security"
      emptyText="Queue güvenlik verisi bulunamadı."
      insight="Operational kuyruklar sadece yetkili service identity'lere açık olmalıdır."
    />
  );
}
