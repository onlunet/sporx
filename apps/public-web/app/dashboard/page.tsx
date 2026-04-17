import { publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../src/lib/fetch-with-schema";
import { ConfidenceChart, MetricCard, RecentActivity, SystemStatus } from "../../src/components/dashboard";
import type { RecentActivityItem } from "../../src/components/dashboard/RecentActivity";
import { Activity, AlertTriangle, BrainCircuit, Clock, LayoutDashboard, Server, TrendingUp, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

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

function normalizeStatus(value: string) {
  return value.trim().toLowerCase();
}

function isLiveStatus(value: string) {
  const normalized = normalizeStatus(value);
  return normalized === "live" || normalized === "inplay" || normalized === "1h" || normalized === "2h" || normalized === "q1" || normalized === "q2" || normalized === "q3" || normalized === "q4";
}

function isCompletedStatus(value: string) {
  const normalized = normalizeStatus(value);
  return (
    normalized === "finished" ||
    normalized === "completed" ||
    normalized === "full_time" ||
    normalized === "ft" ||
    normalized === "aet" ||
    normalized === "pen"
  );
}

function safeIsoDate(value?: string, fallback = new Date().toISOString()) {
  if (!value) {
    return fallback;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback;
  }
  return parsed.toISOString();
}

export default async function DashboardPage() {
  const [dashboardResult, predictionsResult, matchesResult] = await Promise.allSettled([
    fetchWithSchema("/api/v1/analytics/dashboard", publicContract.dashboardResponseSchema, {
      cache: "no-store"
    }),
    fetchWithSchema("/api/v1/predictions?status=scheduled,live,finished&take=220", publicContract.predictionsResponseSchema, {
      cache: "no-store"
    }),
    fetchWithSchema("/api/v1/matches?take=80", publicContract.matchesResponseSchema, {
      cache: "no-store"
    })
  ]);

  const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value.data : EMPTY_DASHBOARD;
  const dashboardUnavailable = dashboardResult.status !== "fulfilled";
  const predictions = predictionsResult.status === "fulfilled" ? predictionsResult.value.data : [];
  const matches = matchesResult.status === "fulfilled" ? matchesResult.value.data : [];

  const highConfidence = predictions.filter((item) => item.confidenceScore >= 0.7).length;
  const mediumConfidence = predictions.filter((item) => item.confidenceScore >= 0.56 && item.confidenceScore < 0.7).length;
  const lowConfidence = predictions.filter((item) => item.confidenceScore < 0.56).length;
  const predictionOverview = predictionsResult.status === "fulfilled" ? { highConfidence, mediumConfidence, lowConfidence } : null;

  const activityRows: RecentActivityItem[] = [];

  activityRows.push({
    id: `dashboard-refresh-${dashboard.generatedAt}`,
    type: "info",
    message: "Dashboard metrikleri guncellendi.",
    at: safeIsoDate(dashboard.generatedAt)
  });

  const liveCount = matches.filter((item) => isLiveStatus(item.status)).length;
  if (liveCount > 0) {
    activityRows.push({
      id: `live-${dashboard.generatedAt}`,
      type: "info",
      message: `${liveCount} canli mac takip ediliyor.`,
      at: safeIsoDate(dashboard.generatedAt)
    });
  }

  const recentCompletedMatches = matches
    .filter((item) => isCompletedStatus(item.status) && item.score.home !== null && item.score.away !== null)
    .sort((left, right) => new Date(right.kickoffAt).getTime() - new Date(left.kickoffAt).getTime())
    .slice(0, 2);

  for (const match of recentCompletedMatches) {
    activityRows.push({
      id: `completed-${match.id}`,
      type: "success",
      message: `${match.homeTeam} - ${match.awayTeam} maci ${match.score.home}-${match.score.away} tamamlandi.`,
      at: safeIsoDate(match.kickoffAt, safeIsoDate(dashboard.generatedAt))
    });
  }

  const topHighConfidence = predictions
    .slice()
    .sort((left, right) => right.confidenceScore - left.confidenceScore)
    .filter((item) => item.confidenceScore >= 0.7)
    .slice(0, 2);

  for (const item of topHighConfidence) {
    if (!item.homeTeam || !item.awayTeam) {
      continue;
    }
    activityRows.push({
      id: `high-${item.matchId}-${item.confidenceScore}`,
      type: "success",
      message: `Yuksek guvenli tahmin: ${item.homeTeam} - ${item.awayTeam} (%${Math.round(item.confidenceScore * 100)}).`,
      at: safeIsoDate(dashboard.generatedAt)
    });
  }

  const firstLowConfidence = predictions
    .slice()
    .sort((left, right) => left.confidenceScore - right.confidenceScore)
    .find((item) => item.confidenceScore < 0.56 && item.homeTeam && item.awayTeam);

  if (firstLowConfidence) {
    activityRows.push({
      id: `low-${firstLowConfidence.matchId}`,
      type: "warning",
      message: `Dusuk guven uyarisi: ${firstLowConfidence.homeTeam} - ${firstLowConfidence.awayTeam}.`,
      at: safeIsoDate(dashboard.generatedAt)
    });
  }

  const recentActivities = activityRows
    .slice()
    .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
    .slice(0, 6);

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10 bg-gradient-to-br from-surface via-abyss to-void p-5 sm:p-6 lg:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 sm:h-96 sm:w-96 rounded-full bg-neon-cyan/10 blur-[80px] sm:blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-48 w-48 sm:h-64 sm:w-64 rounded-full bg-neon-purple/10 blur-[60px] sm:blur-[80px]" />

        <div className="relative">
          <div className="mb-4 sm:mb-6 flex items-center gap-3">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple">
              <LayoutDashboard className="h-5 w-5 sm:h-6 sm:w-6 text-void" />
            </div>
            <div>
              <h1 className="gradient-text font-display text-2xl sm:text-3xl font-bold">Panel</h1>
              <p className="text-xs sm:text-sm text-slate-400">Sistem genel bakis ve analitikler</p>
            </div>
          </div>

          {dashboardUnavailable ? (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Dashboard verisi su anda sinirli. Arka plan servisleri toparlandiginda metrikler otomatik guncellenir.
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            <MetricCard label="Toplam Mac" value={dashboard.matchCount} icon={<Trophy className="h-5 w-5" />} color="cyan" trend="up" trendValue="%12" />
            <MetricCard label="Tahmin Sayisi" value={dashboard.predictionCount} icon={<BrainCircuit className="h-5 w-5" />} color="purple" trend="up" trendValue="%8" />
            <MetricCard label="Dusuk Guven" value={dashboard.lowConfidenceCount} icon={<AlertTriangle className="h-5 w-5" />} color="amber" trend="down" trendValue="%5" />
            <MetricCard label="Basarisiz Analiz" value={dashboard.failedCount} icon={<TrendingUp className="h-5 w-5" />} color="red" trend="neutral" trendValue="0%" />
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
            <Clock className="h-3.5 w-3.5" />
            <span>Son guncelleme: {new Date(dashboard.generatedAt).toLocaleString("tr-TR")}</span>
          </div>
        </div>
      </div>

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="space-y-4 sm:space-y-6 lg:col-span-2">
          <section className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
            <div className="mb-4 sm:mb-6 flex items-center gap-2">
              <BrainCircuit className="h-5 w-5 text-neon-cyan" />
              <h2 className="text-base sm:text-lg font-semibold text-white">Tahmin Guven Dagilimi</h2>
            </div>
            {predictionOverview ? (
              <ConfidenceChart high={predictionOverview.highConfidence} medium={predictionOverview.mediumConfidence} low={predictionOverview.lowConfidence} />
            ) : (
              <p className="py-8 text-center text-slate-400">Guven dagilimi verisi alinamadi.</p>
            )}
          </section>

          <section className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
            <div className="mb-4 sm:mb-6 flex items-center gap-2">
              <Activity className="h-5 w-5 text-neon-purple" />
              <h2 className="text-base sm:text-lg font-semibold text-white">Son Aktiviteler</h2>
            </div>
            <RecentActivity items={recentActivities} />
          </section>
        </div>

        <div>
          <section className="glass-card rounded-xl sm:rounded-2xl p-4 sm:p-6">
            <div className="mb-4 sm:mb-6 flex items-center gap-2">
              <Server className="h-5 w-5 text-neon-green" />
              <h2 className="text-base sm:text-lg font-semibold text-white">Sistem Durumu</h2>
            </div>
            <SystemStatus />
          </section>
        </div>
      </div>
    </div>
  );
}