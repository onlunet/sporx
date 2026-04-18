import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Rate Limit / Abuse Overview"
      subtitle="Rate limit bucket telemetry and blocking trends"
      endpoint="/api/v1/admin/security/phase4/rate-limit-buckets"
      emptyText="Rate limit bucket kaydı yok."
      columns={[
        { key: "ruleId", label: "Kural" },
        { key: "ipAddress", label: "IP" },
        { key: "hits", label: "Hit" },
        { key: "blockedCount", label: "Blocked" },
        { key: "lastSeenAt", label: "Son Görülme" }
      ]}
    />
  );
}
