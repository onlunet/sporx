import { AdminEndpointPage } from "../../_components/admin-endpoint-page";

export default async function Page() {
  return (
    <AdminEndpointPage
      title="Release Attestations"
      subtitle="Build identity and security attestation metadata"
      endpoint="/api/v1/admin/security/phase4/release-attestations"
      emptyText="Release attestation kaydı yok."
      columns={[
        { key: "gitSha", label: "Git SHA" },
        { key: "environment", label: "Ortam" },
        { key: "dependencySnapshotId", label: "Dependency Snapshot" },
        { key: "scanRunId", label: "Scan Run" },
        { key: "createdAt", label: "Tarih" }
      ]}
    />
  );
}
