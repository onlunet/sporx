import Link from "next/link";
import { adminApiGet } from "../_lib/admin-api";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Database,
  Server,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Zap,
  Shield
} from "lucide-react";

type IngestionRun = {
  id: string;
  jobType: string;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  errors: number;
};

type ProviderHealth = {
  provider: string;
  status: string;
  latencyMs: number;
  checkedAt: string;
  message?: string;
};

function MetricCard({
  title,
  value,
  change,
  changeType,
  icon: Icon,
  href
}: {
  title: string;
  value: string | number;
  change?: string;
  changeType?: "positive" | "negative" | "neutral";
  icon: React.ElementType;
  href?: string;
}) {
  const content = (
    <div className="metric-card group cursor-pointer">
      <div className="flex items-start justify-between">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-admin-brand-primary/10">
          <Icon className="h-5 w-5 text-admin-brand-primary" />
        </div>
        {change ? (
          <div
            className={`flex items-center gap-1 text-xs font-medium ${
              changeType === "positive"
                ? "text-admin-success"
                : changeType === "negative"
                  ? "text-admin-error"
                  : "text-admin-text-muted"
            }`}
          >
            {changeType === "positive" ? <TrendingUp className="h-3.5 w-3.5" /> : null}
            {changeType === "negative" ? <TrendingDown className="h-3.5 w-3.5" /> : null}
            {change}
          </div>
        ) : null}
      </div>
      <div className="mt-4">
        <div className="metric-value">{value}</div>
        <div className="metric-label">{title}</div>
      </div>
      {href ? (
        <div className="mt-4 flex items-center gap-1 border-t border-admin-border-subtle pt-4 text-sm text-admin-brand-primary opacity-0 transition-opacity group-hover:opacity-100">
          Detaylar <ArrowRight className="h-4 w-4" />
        </div>
      ) : null}
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { class: string; icon: React.ElementType; label: string }> = {
    healthy: { class: "success", icon: CheckCircle2, label: "Sağlıklı" },
    degraded: { class: "warning", icon: AlertTriangle, label: "Yavaş" },
    down: { class: "error", icon: AlertTriangle, label: "Çevrimdışı" },
    running: { class: "info", icon: Zap, label: "Çalışıyor" },
    queued: { class: "info", icon: Clock, label: "Kuyrukta" },
    succeeded: { class: "success", icon: CheckCircle2, label: "Tamamlandı" },
    failed: { class: "error", icon: AlertTriangle, label: "Başarısız" }
  };

  const variant = variants[status.toLowerCase()] || { class: "info", icon: Activity, label: status };
  const Icon = variant.icon;

  return (
    <span className={`status-badge ${variant.class}`}>
      <Icon className="h-3 w-3" />
      {variant.label}
    </span>
  );
}

function DataTable({
  title,
  subtitle,
  children,
  href
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  href?: string;
}) {
  return (
    <div className="admin-card overflow-hidden">
      <div className="flex items-center justify-between border-b border-admin-border-subtle px-6 py-4">
        <div>
          <h3 className="text-base font-semibold text-admin-text-primary">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-sm text-admin-text-muted">{subtitle}</p> : null}
        </div>
        {href ? (
          <Link href={href} className="text-sm text-admin-brand-primary transition-colors hover:text-admin-brand-secondary">
            Tümünü Gör <ArrowRight className="inline h-4 w-4" />
          </Link>
        ) : null}
      </div>
      {children}
    </div>
  );
}

export default async function AdminDashboardPage() {
  const [jobsResult, providersResult, lowConfidenceResult, failedResult] = await Promise.all([
    adminApiGet<IngestionRun[]>("/api/v1/admin/ingestion/jobs"),
    adminApiGet<ProviderHealth[]>("/api/v1/admin/providers/health"),
    adminApiGet<unknown[]>("/api/v1/admin/predictions/low-confidence"),
    adminApiGet<unknown[]>("/api/v1/admin/predictions/failed")
  ]);

  const jobs = jobsResult.ok && Array.isArray(jobsResult.data) ? jobsResult.data : [];
  const providers = providersResult.ok && Array.isArray(providersResult.data) ? providersResult.data : [];
  const lowConfidence = lowConfidenceResult.ok && Array.isArray(lowConfidenceResult.data) ? lowConfidenceResult.data : [];
  const failedPredictions = failedResult.ok && Array.isArray(failedResult.data) ? failedResult.data : [];

  const queuedJobs = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const failedJobs = jobs.filter((job) => job.status === "failed" || job.errors > 0).length;
  const healthyProviders = providers.filter((provider) => provider.status === "healthy").length;
  const providerHealthRatio = Math.round((healthyProviders / (providers.length || 1)) * 100);

  return (
    <div className="animate-fade-in space-y-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-admin-text-primary">Dashboard</h1>
          <p className="mt-1 text-admin-text-secondary">Sistem genel görünümü ve ana metrikler</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-admin-border-subtle bg-admin-bg-tertiary px-4 py-2">
          <div className="h-2 w-2 animate-pulse rounded-full bg-admin-success" />
          <span className="text-sm text-admin-text-secondary">Son güncelleme: {new Date().toLocaleTimeString("tr-TR")}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Kuyruktaki İşler"
          value={queuedJobs}
          change="Son 1 saat"
          changeType="neutral"
          icon={Server}
          href="/admin/ingestion/jobs"
        />
        <MetricCard
          title="Başarısız İşler"
          value={failedJobs}
          change={failedJobs > 0 ? "Dikkat" : "Normal"}
          changeType={failedJobs > 0 ? "negative" : "positive"}
          icon={AlertTriangle}
          href="/admin/ingestion/jobs"
        />
        <MetricCard
          title="Düşük Güven Tahmin"
          value={lowConfidence.length}
          change="İncelenmeli"
          changeType={lowConfidence.length > 10 ? "negative" : "positive"}
          icon={Shield}
          href="/admin/predictions/low-confidence"
        />
        <MetricCard
          title="Sağlıklı Sağlayıcı"
          value={`${healthyProviders}/${providers.length}`}
          change={`%${providerHealthRatio}`}
          changeType="positive"
          icon={Database}
          href="/admin/providers/health"
        />
      </div>

      {!jobsResult.ok || !providersResult.ok || !lowConfidenceResult.ok || !failedResult.ok ? (
        <div className="flex items-center gap-3 rounded-xl border border-admin-warning/20 bg-admin-warning/10 p-4 text-admin-warning">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <p className="text-sm">Bazı dashboard verileri alınamadı. Ayrıntılar için ilgili menü sayfasını kontrol edin.</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DataTable title="Son İçe Aktarım İşlemleri" subtitle="En son veri işleme kayıtları" href="/admin/ingestion/jobs">
          {jobs.length === 0 ? (
            <div className="p-8 text-center">
              <Server className="mx-auto mb-3 h-12 w-12 text-admin-text-muted" />
              <p className="text-admin-text-secondary">Henüz işlem kaydı bulunmuyor.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="admin-table w-full">
                <thead>
                  <tr>
                    <th>İş Tipi</th>
                    <th>Durum</th>
                    <th>Hata</th>
                    <th>Başlangıç</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.slice(0, 6).map((job) => (
                    <tr key={job.id}>
                      <td className="font-medium">{job.jobType}</td>
                      <td>
                        <StatusBadge status={job.status} />
                      </td>
                      <td>
                        {job.errors > 0 ? (
                          <span className="font-medium text-admin-error">{job.errors}</span>
                        ) : (
                          <span className="text-admin-text-muted">-</span>
                        )}
                      </td>
                      <td className="text-admin-text-secondary">
                        {job.startedAt ? new Date(job.startedAt).toLocaleString("tr-TR") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataTable>

        <DataTable title="Sağlayıcı Sağlık Durumu" subtitle="Veri sağlayıcılarının durumu" href="/admin/providers/health">
          {providers.length === 0 ? (
            <div className="p-8 text-center">
              <Database className="mx-auto mb-3 h-12 w-12 text-admin-text-muted" />
              <p className="text-admin-text-secondary">Henüz sağlayıcı bilgisi yok.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="admin-table w-full">
                <thead>
                  <tr>
                    <th>Sağlayıcı</th>
                    <th>Durum</th>
                    <th>Gecikme</th>
                    <th>Son Kontrol</th>
                  </tr>
                </thead>
                <tbody>
                  {providers.slice(0, 6).map((provider) => (
                    <tr key={provider.provider}>
                      <td className="font-medium">{provider.provider}</td>
                      <td>
                        <StatusBadge status={provider.status} />
                      </td>
                      <td>
                        <span className={provider.latencyMs > 1000 ? "text-admin-warning" : "text-admin-success"}>
                          {provider.latencyMs}ms
                        </span>
                      </td>
                      <td className="text-admin-text-secondary">{new Date(provider.checkedAt).toLocaleString("tr-TR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataTable>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="admin-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-admin-error/10">
              <AlertTriangle className="h-6 w-6 text-admin-error" />
            </div>
            <div>
              <div className="text-2xl font-bold text-admin-text-primary">{failedPredictions.length}</div>
              <div className="text-sm text-admin-text-secondary">Başarısız Tahmin</div>
            </div>
          </div>
          <Link href="/admin/predictions/failed" className="mt-4 block text-sm text-admin-brand-primary hover:underline">
            Detayları Gör →
          </Link>
        </div>

        <div className="admin-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-admin-warning/10">
              <Shield className="h-6 w-6 text-admin-warning" />
            </div>
            <div>
              <div className="text-2xl font-bold text-admin-text-primary">{lowConfidence.length}</div>
              <div className="text-sm text-admin-text-secondary">Düşük Güven Tahmini</div>
            </div>
          </div>
          <Link href="/admin/predictions/low-confidence" className="mt-4 block text-sm text-admin-brand-primary hover:underline">
            İncele →
          </Link>
        </div>

        <div className="admin-card p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-admin-success/10">
              <CheckCircle2 className="h-6 w-6 text-admin-success" />
            </div>
            <div>
              <div className="text-2xl font-bold text-admin-text-primary">%{providerHealthRatio}</div>
              <div className="text-sm text-admin-text-secondary">Sistem Sağlığı</div>
            </div>
          </div>
          <Link href="/admin/system/settings" className="mt-4 block text-sm text-admin-brand-primary hover:underline">
            Ayarları Yönet →
          </Link>
        </div>
      </div>
    </div>
  );
}
