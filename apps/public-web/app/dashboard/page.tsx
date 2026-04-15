import { publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../src/lib/fetch-with-schema";
import { MetricCard, ConfidenceChart, RecentActivity, SystemStatus } from "../../src/components/dashboard";
import {
  LayoutDashboard,
  Trophy,
  BrainCircuit,
  AlertTriangle,
  TrendingUp,
  Activity,
  Server,
  Clock
} from "lucide-react";

export const revalidate = 30;

type DashboardSnapshot = {
  matchCount: number;
  predictionCount: number;
  lowConfidenceCount: number;
  failedCount: number;
  generatedAt: string;
};

const EMPTY_DASHBOARD: DashboardSnapshot = {
  matchCount: 0,
  predictionCount: 0,
  lowConfidenceCount: 0,
  failedCount: 0,
  generatedAt: new Date().toISOString()
};

export default async function DashboardPage() {
  const [dashboardResult, predictionsResult] = await Promise.allSettled([
    fetchWithSchema("/api/v1/analytics/dashboard", publicContract.dashboardResponseSchema),
    fetchWithSchema("/api/v1/predictions?take=40", publicContract.predictionsResponseSchema)
  ]);

  const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value.data : EMPTY_DASHBOARD;
  const dashboardUnavailable = dashboardResult.status !== "fulfilled";

  let predictionOverview: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  } | null = null;

  if (predictionsResult.status === "fulfilled") {
    const predictions = predictionsResult.value.data;
    const highConfidence = predictions.filter((item) => item.confidenceScore >= 0.7).length;
    const mediumConfidence = predictions.filter(
      (item) => item.confidenceScore >= 0.56 && item.confidenceScore < 0.7
    ).length;
    const lowConfidence = predictions.filter((item) => item.confidenceScore < 0.56).length;
    predictionOverview = { highConfidence, mediumConfidence, lowConfidence };
  }

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-surface via-abyss to-void p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-neon-cyan/10 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-64 w-64 rounded-full bg-neon-purple/10 blur-[80px]" />

        <div className="relative">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple">
              <LayoutDashboard className="h-6 w-6 text-void" />
            </div>
            <div>
              <h1 className="gradient-text font-display text-3xl font-bold">Panel</h1>
              <p className="text-sm text-slate-400">Sistem genel bakış ve analitikler</p>
            </div>
          </div>

          {dashboardUnavailable ? (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Dashboard verisi şu anda sınırlı. Arka plan servisleri toparlandığında metrikler otomatik güncellenir.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard
              label="Toplam Maç"
              value={dashboard.matchCount}
              icon={<Trophy className="h-5 w-5" />}
              color="cyan"
              trend="up"
              trendValue="%12"
            />
            <MetricCard
              label="Tahmin Sayısı"
              value={dashboard.predictionCount}
              icon={<BrainCircuit className="h-5 w-5" />}
              color="purple"
              trend="up"
              trendValue="%8"
            />
            <MetricCard
              label="Düşük Güven"
              value={dashboard.lowConfidenceCount}
              icon={<AlertTriangle className="h-5 w-5" />}
              color="amber"
              trend="down"
              trendValue="%5"
            />
            <MetricCard
              label="Başarısız Analiz"
              value={dashboard.failedCount}
              icon={<TrendingUp className="h-5 w-5" />}
              color="red"
              trend="neutral"
              trendValue="0%"
            />
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            <span>Son güncelleme: {new Date(dashboard.generatedAt).toLocaleString("tr-TR")}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="glass-card rounded-2xl p-6">
            <div className="mb-6 flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-neon-cyan" />
              <h2 className="text-lg font-semibold text-white">Tahmin Güven Dağılımı</h2>
            </div>
            {predictionOverview ? (
              <ConfidenceChart
                high={predictionOverview.highConfidence}
                medium={predictionOverview.mediumConfidence}
                low={predictionOverview.lowConfidence}
              />
            ) : (
              <p className="py-8 text-center text-slate-400">Güven dağılımı verisi alınamadı.</p>
            )}
          </section>

          <section className="glass-card rounded-2xl p-6">
            <div className="mb-6 flex items-center gap-2">
              <Activity className="h-5 w-5 text-neon-purple" />
              <h2 className="text-lg font-semibold text-white">Son Aktiviteler</h2>
            </div>
            <RecentActivity />
          </section>
        </div>

        <div>
          <section className="glass-card rounded-2xl p-6">
            <div className="mb-6 flex items-center gap-2">
              <Server className="h-5 w-5 text-neon-green" />
              <h2 className="text-lg font-semibold text-white">Sistem Durumu</h2>
            </div>
            <SystemStatus />
          </section>
        </div>
      </div>
    </div>
  );
}