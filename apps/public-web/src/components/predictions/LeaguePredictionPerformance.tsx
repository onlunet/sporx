"use client";

import Link from "next/link";
import { useMemo } from "react";
import { BarChart3, CheckCircle2, Layers, Trophy, XCircle } from "lucide-react";
import {
  MatchPredictionItem,
  buildLeaguePredictionPerformanceReport,
  isCompletedMatchStatus,
  usePredictionsByType
} from "../../features/predictions";

type LeaguePredictionPerformanceProps = {
  sport?: "football" | "basketball";
};

function sportLabel(sport?: "football" | "basketball") {
  if (sport === "basketball") {
    return "Basketbol";
  }
  return "Futbol";
}

export function LeaguePredictionPerformance({ sport }: LeaguePredictionPerformanceProps = {}) {
  const finishedQuery = usePredictionsByType("all", "finished", 300, sport);
  const fallbackQuery = usePredictionsByType("all", undefined, 300, sport);

  const completedItems = useMemo(() => {
    const sortRows = (rows: MatchPredictionItem[]) =>
      rows
        .slice()
        .sort((left, right) => {
          const leftTime = left.matchDateTimeUTC ? new Date(left.matchDateTimeUTC).getTime() : 0;
          const rightTime = right.matchDateTimeUTC ? new Date(right.matchDateTimeUTC).getTime() : 0;
          return rightTime - leftTime;
        });

    const fromFinished = sortRows((finishedQuery.data ?? []).filter((item) => isCompletedMatchStatus(item.matchStatus)));
    if (fromFinished.length > 0) {
      return fromFinished;
    }
    return sortRows((fallbackQuery.data ?? []).filter((item) => isCompletedMatchStatus(item.matchStatus)));
  }, [fallbackQuery.data, finishedQuery.data]);

  const report = useMemo(() => buildLeaguePredictionPerformanceReport(completedItems), [completedItems]);
  const isLoading = finishedQuery.isLoading || fallbackQuery.isLoading;
  const isError = finishedQuery.isError && fallbackQuery.isError && completedItems.length === 0;
  const sportPrefix = sport ? `/${sport}` : "/football";

  if (isLoading && completedItems.length === 0) {
    return (
      <div className="space-y-4">
        <div className="h-24 rounded-xl bg-white/5 animate-pulse" />
        <div className="h-64 rounded-xl bg-white/5 animate-pulse" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-rose-500/20 bg-rose-500/5 p-6">
        <h2 className="text-lg font-semibold text-white">Lig bazli rapor verisi alinamadi</h2>
        <p className="mt-2 text-sm text-slate-300">Lutfen birkac saniye sonra tekrar deneyin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-neon-cyan">
            <BarChart3 className="h-4 w-4" />
            <span className="text-xs uppercase tracking-[0.2em]">Lig Bazli Performans</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href={`${sportPrefix}/predictions/completed`}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-neon-cyan/40 hover:text-neon-cyan"
            >
              Genel Sonuclar
            </Link>
            <Link
              href={`${sportPrefix}/predictions`}
              className="rounded-lg border border-white/10 px-3 py-1 text-xs text-slate-300 transition hover:border-neon-cyan/40 hover:text-neon-cyan"
            >
              Tahminler
            </Link>
          </div>
        </div>
        <h1 className="mt-2 text-3xl font-display font-bold text-white">{sportLabel(sport)} Lig Basari Ozeti</h1>
        <p className="mt-2 text-sm text-slate-300">
          Hangi ligde hangi tahmin turunun daha iyi calistigini tek ekranda gorebilirsiniz.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <Layers className="h-4 w-4 text-neon-cyan" />
            Lig Sayisi
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.leagueCount}</div>
          <div className="mt-1 text-xs text-slate-500">Toplam mac: {report.summary.uniqueMatchCount}</div>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">Degerlendirilen Tahmin</div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.evaluatedPredictions}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Dogru Tahmin
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.correctPredictions}</div>
          <div className="mt-1 text-xs text-slate-500">Basarisiz: {report.summary.failedPredictions}</div>
        </div>
        <div className="rounded-xl border border-neon-cyan/20 bg-neon-cyan/5 p-4">
          <div className="flex items-center gap-2 text-xs text-neon-cyan">
            <Trophy className="h-4 w-4" />
            Genel Basari
          </div>
          <div className="mt-1 text-2xl font-bold text-white">%{report.summary.successRate.toFixed(1)}</div>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Lig Bazli Ozet Tablosu</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-400">
                <th className="py-2 pr-3 font-medium">Lig</th>
                <th className="py-2 pr-3 font-medium">Degerlendirilen</th>
                <th className="py-2 pr-3 font-medium">Dogru</th>
                <th className="py-2 pr-3 font-medium">Basarisiz</th>
                <th className="py-2 pr-3 font-medium">Basari</th>
                <th className="py-2 pr-3 font-medium">En Basarili Tahmin Turu</th>
              </tr>
            </thead>
            <tbody>
              {report.leagues.map((league) => (
                <tr key={league.leagueKey} className="border-b border-white/5 text-slate-200">
                  <td className="py-2 pr-3">{league.leagueLabel}</td>
                  <td className="py-2 pr-3">{league.evaluated}</td>
                  <td className="py-2 pr-3 text-emerald-300">{league.correct}</td>
                  <td className="py-2 pr-3 text-rose-300">{league.failed}</td>
                  <td className="py-2 pr-3 font-semibold text-neon-cyan">%{league.successRate.toFixed(1)}</td>
                  <td className="py-2 pr-3">
                    {league.topTypeLabel} (%{league.topTypeAccuracy.toFixed(1)})
                  </td>
                </tr>
              ))}
              {report.leagues.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-slate-400">
                    Lig bazli degerlendirilebilir tahmin bulunamadi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Lig Detayi: Tahmin Turu Basarilari</h2>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {report.leagues.map((league) => (
            <div key={`${league.leagueKey}-detail`} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold text-white">{league.leagueLabel}</div>
                <div className="text-xs text-neon-cyan">%{league.successRate.toFixed(1)}</div>
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Degerlendirilen: {league.evaluated} | Dogru: {league.correct} | Basarisiz: {league.failed}
              </div>

              <div className="mt-3 space-y-2">
                {league.byType.slice(0, 6).map((typeRow) => (
                  <div key={`${league.leagueKey}-${typeRow.key}`} className="rounded-lg border border-white/10 bg-depth/50 p-2">
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-200">{typeRow.label}</span>
                      <span className="font-semibold text-neon-green">%{typeRow.accuracy.toFixed(1)}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-slate-500">
                      Degerlendirilen: {typeRow.evaluated} | Dogru: {typeRow.correct} | Basarisiz: {typeRow.failed}
                    </div>
                  </div>
                ))}
                {league.byType.length === 0 && (
                  <div className="rounded-lg border border-white/10 bg-depth/50 p-2 text-xs text-slate-400">
                    Bu lig icin tur bazli degerlendirilebilir veri bulunamadi.
                  </div>
                )}
              </div>
            </div>
          ))}
          {report.leagues.length === 0 && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-400">
              Lig detay karti uretilemedi.
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

