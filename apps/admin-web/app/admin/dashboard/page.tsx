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

// Metric Card Component
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
        <div className="w-10 h-10 rounded-lg bg-admin-brand-primary/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-admin-brand-primary" />
        </div>
        {change && (
          <div className={`flex items-center gap-1 text-xs font-medium ${
            changeType === "positive" ? "text-admin-success" : 
            changeType === "negative" ? "text-admin-error" : 
            "text-admin-text-muted"
          }`}>
            {changeType === "positive" && <TrendingUp className="w-3.5 h-3.5" />}
            {changeType === "negative" && <TrendingDown className="w-3.5 h-3.5" />}
            {change}
          </div>
        )}
      </div>
      <div className="mt-4">
        <div className="metric-value">{value}</div>
        <div className="metric-label">{title}</div>
      </div>
      {href && (
        <div className="mt-4 pt-4 border-t border-admin-border-subtle flex items-center gap-1 text-sm text-admin-brand-primary opacity-0 group-hover:opacity-100 transition-opacity"
        >
          Detaylar <ArrowRight className="w-4 h-4" />
        </div>
      )}
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

// Status Badge Component
function StatusBadge({ status }: { status: string }) {
  const variants: Record<string, { class: string; icon: React.ElementType; label: string }> = {
    healthy: { class: "success", icon: CheckCircle2, label: "Sa�l�kl�" },
    degraded: { class: "warning", icon: AlertTriangle, label: "Yava�" },
    down: { class: "error", icon: AlertTriangle, label: "�evrimd���" },
    running: { class: "info", icon: Zap, label: "�al���yor" },
    queued: { class: "info", icon: Clock, label: "Kuyrukta" },
    succeeded: { class: "success", icon: CheckCircle2, label: "Tamamland�" },
    failed: { class: "error", icon: AlertTriangle, label: "Ba�ar�s�z" },
  };

  const variant = variants[status.toLowerCase()] || { class: "info", icon: Activity, label: status };
  const Icon = variant.icon;

  return (
    <span className={`status-badge ${variant.class}`}>
      <Icon className="w-3 h-3" />
      {variant.label}
    </span>
  );
}

// Table Component
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
      <div className="px-6 py-4 border-b border-admin-border-subtle flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-admin-text-primary">{title}</h3>
          {subtitle && <p className="text-sm text-admin-text-muted mt-0.5">{subtitle}</p>}
        </div>
        {href && (
          <Link href={href} className="text-sm text-admin-brand-primary hover:text-admin-brand-secondary transition-colors"
          >
            T�m�n� G�r <ArrowRight className="w-4 h-4 inline" />
          </Link>
        )}
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
  const healthyProviders = providers.filter((p) => p.status === "healthy").length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-admin-text-primary">Dashboard</h1>
          <p className="text-admin-text-secondary mt-1">Sistem genel g�r�n�m� ve ana metrikler</p>
        </div>
        <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-admin-bg-tertiary border border-admin-border-subtle">
          <div className="w-2 h-2 rounded-full bg-admin-success animate-pulse" />
          <span className="text-sm text-admin-text-secondary">Son g�ncelleme: {new Date().toLocaleTimeString('tr-TR')}</span>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Kuyruktaki ��ler"
          value={queuedJobs}
          change="Son 1 saat"
          changeType="neutral"
          icon={Server}
          href="/admin/ingestion/jobs"
        />
        <MetricCard
          title="Ba�ar�s�z ��ler"
          value={failedJobs}
          change={failedJobs > 0 ? "Dikkat" : "Normal"}
          changeType={failedJobs > 0 ? "negative" : "positive"}
          icon={AlertTriangle}
          href="/admin/ingestion/jobs"
        />
        <MetricCard
          title="D���k G�ven Tahmin"
          value={lowConfidence.length}
          change="�ncelenmeli"
          changeType={lowConfidence.length > 10 ? "negative" : "positive"}
          icon={Shield}
          href="/admin/predictions/low-confidence"
        />
        <MetricCard
          title="Sa�l�kl� Sağlayıcı"
          value={`${healthyProviders}/${providers.length}`}
          change="%{Math.round((healthyProviders / (providers.length || 1)) * 100)}"
          changeType="positive"
          icon={Database}
          href="/admin/providers/health"
        />
      </div>

      {/* Error Alert */}
      {(!jobsResult.ok || !providersResult.ok || !lowConfidenceResult.ok || !failedResult.ok) && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-admin-warning/10 border border-admin-warning/20 text-admin-warning"
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm">
            Baz� dashboard verileri al�namad�. Ayr�nt�lar i�in ilgili men� sayfas�n� kontrol edin.
          </p>
        </div>
      )}

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Jobs Table */}
        <DataTable 
          title="Son İçe Aktar�m İşlemleri" 
          subtitle="En son veri işleme kay�tlar�"
          href="/admin/ingestion/jobs"
        >
          {jobs.length === 0 ? (
            <div className="p-8 text-center">
              <Server className="w-12 h-12 text-admin-text-muted mx-auto mb-3" />
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
                    <td><StatusBadge status={job.status} /></td>
                    <td>
                      {job.errors > 0 ? (
                        <span className="text-admin-error font-medium">{job.errors}</span>
                      ) : (
                        <span className="text-admin-text-muted">-</span>
                      )}
                    </td>
                    <td className="text-admin-text-secondary">{job.startedAt ? new Date(job.startedAt).toLocaleString("tr-TR") : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          )}
        </DataTable>

        <DataTable 
          title="Sağlayıcı Sağlık Durumu" 
          subtitle="Veri sağlayıcılarının durumu"
          href="/admin/providers/health"
        >
          {providers.length === 0 ? (
            <div className="p-8 text-center">
              <Database className="w-12 h-12 text-admin-text-muted mx-auto mb-3" />
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
                    <td><StatusBadge status={provider.status} /></td>
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="admin-card p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-admin-error/10 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-admin-error" />
            </div>
            <div>
              <div className="text-2xl font-bold text-admin-text-primary">{failedPredictions.length}</div>
              <div className="text-sm text-admin-text-secondary">Ba�ar�s�z Tahmin</div>
            </div>
          </div>
          <Link href="/admin/predictions/failed" className="mt-4 block text-sm text-admin-brand-primary hover:underline">
            Detaylar� G�r �
          </Link>
        </div>

        <div className="admin-card p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-admin-warning/10 flex items-center justify-center">
              <Shield className="w-6 h-6 text-admin-warning" />
            </div>
            <div>
              <div className="text-2xl font-bold text-admin-text-primary">{lowConfidence.length}</div>
              <div className="text-sm text-admin-text-secondary">D���k G�ven Tahmini</div>
            </div>
          </div>
          <Link href="/admin/predictions/low-confidence" className="mt-4 block text-sm text-admin-brand-primary hover:underline">
            �ncele �
          </Link>
        </div>

        <div className="admin-card p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-lg bg-admin-success/10 flex items-center justify-center">
              <CheckCircle2 className="w-6 h-6 text-admin-success" />
            </div>
            <div>
              <div className="text-2xl font-bold text-admin-text-primary">%{Math.round((healthyProviders / (providers.length || 1)) * 100)}</div>
              <div className="text-sm text-admin-text-secondary">Sistem Sa�l���</div>
            </div>
          </div>
          <Link href="/admin/system/settings" className="mt-4 block text-sm text-admin-brand-primary hover:underline">
            Ayarlar� Y�net �
          </Link>
        </div>
      </div>
    </div>
  );
}
