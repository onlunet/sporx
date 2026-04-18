"use client";

import { useMemo, useState } from "react";
import { BarChart3, CalendarDays, CheckCircle2, Gauge, Trophy, XCircle } from "lucide-react";
import {
  MatchPredictionItem,
  buildLeaguePredictionPerformanceReport,
  buildPredictionPerformanceReport,
  evaluatePredictionResult,
  isCompletedMatchStatus,
  usePredictionsByType
} from "../../features/predictions";

type TimeWindowKey = "daily" | "weekly" | "monthly" | "quarterly";

type WindowConfig = {
  key: TimeWindowKey;
  label: string;
  days: number;
};

type ConfidenceBandSummary = {
  label: string;
  evaluated: number;
  correct: number;
  accuracy: number;
};

const WINDOW_CONFIGS: WindowConfig[] = [
  { key: "daily", label: "Günlük", days: 1 },
  { key: "weekly", label: "Haftalık", days: 7 },
  { key: "monthly", label: "Aylık", days: 30 },
  { key: "quarterly", label: "3 Aylık", days: 90 }
];

const MS_IN_DAY = 24 * 60 * 60 * 1000;

function resolveEventTimestamp(item: MatchPredictionItem): number | null {
  const timeCandidates = [item.matchDateTimeUTC, item.updatedAt];
  for (const candidate of timeCandidates) {
    if (!candidate) {
      continue;
    }
    const parsed = new Date(candidate).getTime();
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
}

function normalizeConfidenceScore(value?: number | null): number | null {
  if (!Number.isFinite(value ?? NaN)) {
    return null;
  }
  const numeric = Number(value);
  if (numeric <= 1) {
    return Math.max(0, Math.min(100, numeric * 100));
  }
  return Math.max(0, Math.min(100, numeric));
}

function summarizeConfidenceBand(items: MatchPredictionItem[], minInclusive: number, maxExclusive: number, label: string): ConfidenceBandSummary {
  let evaluated = 0;
  let correct = 0;

  for (const item of items) {
    const confidenceScore = normalizeConfidenceScore(item.confidenceScore);
    if (confidenceScore === null || confidenceScore < minInclusive || confidenceScore >= maxExclusive) {
      continue;
    }

    const result = evaluatePredictionResult(item);
    if (result === null) {
      continue;
    }

    evaluated += 1;
    if (result) {
      correct += 1;
    }
  }

  return {
    label,
    evaluated,
    correct,
    accuracy: evaluated > 0 ? Number(((correct / evaluated) * 100).toFixed(1)) : 0
  };
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) {
    return "0.0";
  }
  return value.toFixed(1);
}

export function FootballSuccessRatesDashboard() {
  const [activeWindow, setActiveWindow] = useState<TimeWindowKey>("weekly");
  const finishedQuery = usePredictionsByType("all", "finished", 1200, "football");

  const completedItems = useMemo(() => {
    const rows = (finishedQuery.data ?? []).filter((item) => isCompletedMatchStatus(item.matchStatus));

    return rows
      .slice()
      .sort((left, right) => {
        const leftTime = resolveEventTimestamp(left) ?? 0;
        const rightTime = resolveEventTimestamp(right) ?? 0;
        return rightTime - leftTime;
      });
  }, [finishedQuery.data]);

  const windows = useMemo(() => {
    const now = Date.now();
    const map = new Map<
      TimeWindowKey,
      {
        items: MatchPredictionItem[];
        performance: ReturnType<typeof buildPredictionPerformanceReport>;
        leaguePerformance: ReturnType<typeof buildLeaguePredictionPerformanceReport>;
        topLeagues: ReturnType<typeof buildLeaguePredictionPerformanceReport>["leagues"];
        confidenceBands: ConfidenceBandSummary[];
      }
    >();

    for (const window of WINDOW_CONFIGS) {
      const cutoff = now - window.days * MS_IN_DAY;
      const items = completedItems.filter((item) => {
        const timestamp = resolveEventTimestamp(item);
        return timestamp !== null && timestamp >= cutoff;
      });

      const performance = buildPredictionPerformanceReport(items);
      const leaguePerformance = buildLeaguePredictionPerformanceReport(items);
      const minimumSample =
        performance.summary.evaluatedPredictions >= 220 ? 10 : performance.summary.evaluatedPredictions >= 120 ? 5 : 2;

      const filteredLeagues = leaguePerformance.leagues.filter((row) => row.evaluated >= minimumSample);
      const topLeagues = (filteredLeagues.length > 0 ? filteredLeagues : leaguePerformance.leagues).slice(0, 20);

      map.set(window.key, {
        items,
        performance,
        leaguePerformance,
        topLeagues,
        confidenceBands: [
          summarizeConfidenceBand(items, 70, 101, "Yüksek Güven (70+)"),
          summarizeConfidenceBand(items, 55, 70, "Orta Güven (55-69.9)"),
          summarizeConfidenceBand(items, 0, 55, "Düşük Güven (<55)")
        ]
      });
    }

    return map;
  }, [completedItems]);

  const activeData = windows.get(activeWindow);
  const isLoading = finishedQuery.isLoading && completedItems.length === 0;
  const isError = finishedQuery.isError && completedItems.length === 0;

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-24 animate-pulse rounded-xl bg-white/5" />
        <div className="h-72 animate-pulse rounded-xl bg-white/5" />
      </div>
    );
  }

  if (isError || !activeData) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6">
        <h2 className="text-lg font-semibold text-white">Başarı oranı verisi alınamadı</h2>
        <p className="mt-2 text-sm text-slate-300">Lütfen birkaç saniye sonra tekrar deneyin.</p>
      </div>
    );
  }

  const report = activeData.performance;
  const typeLeaders = report.byType.filter((row) => row.evaluated > 0).slice(0, 8);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-white/10 bg-surface/60 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-neon-cyan">
            <Gauge className="h-4 w-4" />
            <span className="text-xs uppercase tracking-[0.2em]">Tahmin Başarı Oranları</span>
          </div>
          <div className="text-xs text-slate-400">Sadece sonuçlanmış futbol tahminleri değerlendirilir.</div>
        </div>
        <h1 className="mt-2 text-3xl font-display font-bold text-white">Futbol Başarı Oranları</h1>
        <p className="mt-2 text-sm text-slate-300">
          Günlük, haftalık, aylık ve 3 aylık performansı karşılaştırın; en başarılı ligleri ve en verimli tahmin tiplerini tek
          ekranda görün.
        </p>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <div className="mb-3 flex items-center gap-2 text-slate-300">
          <CalendarDays className="h-4 w-4 text-neon-cyan" />
          <span className="text-sm font-medium">Zaman Aralığı</span>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          {WINDOW_CONFIGS.map((window) => {
            const data = windows.get(window.key);
            const summary = data?.performance.summary;
            const active = window.key === activeWindow;

            return (
              <button
                key={window.key}
                type="button"
                onClick={() => setActiveWindow(window.key)}
                className={`rounded-xl border p-3 text-left transition ${
                  active
                    ? "border-neon-cyan/60 bg-neon-cyan/10"
                    : "border-white/10 bg-white/5 hover:border-neon-cyan/30 hover:bg-neon-cyan/5"
                }`}
              >
                <div className="text-sm font-semibold text-white">{window.label}</div>
                <div className="mt-1 text-xs text-slate-400">
                  Başarı: %{formatPct(summary?.successRate ?? 0)} | Değerlendirilen: {summary?.evaluatedPredictions ?? 0}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <BarChart3 className="h-4 w-4 text-neon-cyan" />
            Değerlendirilen
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.evaluatedPredictions}</div>
          <div className="mt-1 text-xs text-slate-500">Maç sayısı: {report.summary.uniqueMatchCount}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Doğru
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.correctPredictions}</div>
        </div>
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <div className="flex items-center gap-2 text-xs text-rose-300">
            <XCircle className="h-4 w-4" />
            Başarısız
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.failedPredictions}</div>
        </div>
        <div className="rounded-xl border border-neon-cyan/20 bg-neon-cyan/5 p-4">
          <div className="flex items-center gap-2 text-xs text-neon-cyan">
            <Trophy className="h-4 w-4" />
            Genel Başarı
          </div>
          <div className="mt-1 text-2xl font-bold text-white">%{formatPct(report.summary.successRate)}</div>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Tahmin Analizinde En Başarılı 20 Lig</h2>
        <p className="mt-1 text-xs text-slate-400">
          Sıralama başarı oranına göre yapılır, eşitlikte değerlendirme adedi yüksek olan lig öne çıkar.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-400">
                <th className="py-2 pr-3 font-medium">#</th>
                <th className="py-2 pr-3 font-medium">Lig</th>
                <th className="py-2 pr-3 font-medium">Değerlendirilen</th>
                <th className="py-2 pr-3 font-medium">Doğru</th>
                <th className="py-2 pr-3 font-medium">Başarı</th>
                <th className="py-2 pr-3 font-medium">En İyi Tahmin Tipi</th>
              </tr>
            </thead>
            <tbody>
              {activeData.topLeagues.map((league, index) => (
                <tr key={league.leagueKey} className="border-b border-white/5 text-slate-200">
                  <td className="py-2 pr-3">{index + 1}</td>
                  <td className="py-2 pr-3">{league.leagueLabel}</td>
                  <td className="py-2 pr-3">{league.evaluated}</td>
                  <td className="py-2 pr-3 text-emerald-300">{league.correct}</td>
                  <td className="py-2 pr-3 font-semibold text-neon-cyan">%{formatPct(league.successRate)}</td>
                  <td className="py-2 pr-3">
                    {league.topTypeLabel} (%{formatPct(league.topTypeAccuracy)})
                  </td>
                </tr>
              ))}
              {activeData.topLeagues.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-3 text-slate-400">
                    Bu aralıkta lig bazlı değerlendirilebilir veri bulunamadı.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-surface/50 p-4">
          <h2 className="text-lg font-semibold text-white">En Verimli Tahmin Tipleri</h2>
          <div className="mt-3 grid gap-2">
            {typeLeaders.map((row) => (
              <div key={row.key} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{row.label}</span>
                  <span className="text-sm font-semibold text-neon-green">%{formatPct(row.accuracy)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Değerlendirilen: {row.evaluated} | Doğru: {row.correct} | Başarısız: {row.failed}
                </div>
              </div>
            ))}
            {typeLeaders.length === 0 ? (
              <div className="rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-slate-400">
                Tahmin tipi bazında yeterli veri oluşmadı.
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-surface/50 p-4">
          <h2 className="text-lg font-semibold text-white">Güven Bandı Başarı Özeti</h2>
          <div className="mt-3 grid gap-2">
            {activeData.confidenceBands.map((band) => (
              <div key={band.label} className="rounded-lg border border-white/10 bg-white/5 p-3">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-white">{band.label}</span>
                  <span className="text-sm font-semibold text-neon-cyan">%{formatPct(band.accuracy)}</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">
                  Değerlendirilen: {band.evaluated} | Doğru: {band.correct}
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Not: Güven bandı hesaplaması sadece confidence skoru olan ve sonuç üretmiş tahminlerde yapılır.
          </p>
        </div>
      </section>
    </div>
  );
}

