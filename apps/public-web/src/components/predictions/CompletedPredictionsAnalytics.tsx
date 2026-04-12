"use client";

import { useMemo } from "react";
import { BarChart3, CheckCircle2, Target, XCircle } from "lucide-react";
import {
  MatchPredictionItem,
  buildPredictionPerformanceReport,
  evaluatePredictionResult,
  predictionTypeLabel,
  usePredictionsByType
} from "../../features/predictions";

function pickTopProbabilityLabel(item: MatchPredictionItem): string {
  const probabilities = item.probabilities;
  if (!probabilities) {
    return item.selectionLabel ?? "-";
  }
  const entries = Object.entries(probabilities).filter((entry) => Number.isFinite(entry[1]));
  if (entries.length === 0) {
    return item.selectionLabel ?? "-";
  }
  const best = entries.sort((left, right) => right[1] - left[1])[0];
  const key = best[0];
  if (key === "home") return "Ev";
  if (key === "draw") return "Beraberlik";
  if (key === "away") return "Deplasman";
  if (key === "yes" || key === "bttsYes") return "KG Var";
  if (key === "no" || key === "bttsNo") return "KG Yok";
  if (key === "over") return `Ust ${item.line ?? ""}`.trim();
  if (key === "under") return `Alt ${item.line ?? ""}`.trim();
  return item.selectionLabel ?? key;
}

function verdictLabel(item: MatchPredictionItem): { text: string; className: string } {
  const result = evaluatePredictionResult(item);
  if (result === true) {
    return { text: "Dogru", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  }
  if (result === false) {
    return { text: "Basarisiz", className: "border-rose-500/30 bg-rose-500/10 text-rose-300" };
  }
  return { text: "Degerlendirilemedi", className: "border-slate-500/30 bg-slate-500/10 text-slate-300" };
}

function asScore(item: MatchPredictionItem): string {
  if (item.homeScore === null || item.homeScore === undefined || item.awayScore === null || item.awayScore === undefined) {
    return "-";
  }
  return `${item.homeScore}-${item.awayScore}`;
}

function shortModelId(modelId: string): string {
  if (modelId === "Bilinmeyen") {
    return modelId;
  }
  if (modelId.length <= 12) {
    return modelId;
  }
  return `${modelId.slice(0, 8)}...${modelId.slice(-4)}`;
}

export function CompletedPredictionsAnalytics() {
  const finishedQuery = usePredictionsByType("all", "finished");
  const fallbackQuery = usePredictionsByType("all");

  const playedItems = useMemo(() => {
    const sortRows = (rows: MatchPredictionItem[]) =>
      rows
        .slice()
        .sort((left, right) => {
          const leftTime = left.matchDateTimeUTC ? new Date(left.matchDateTimeUTC).getTime() : 0;
          const rightTime = right.matchDateTimeUTC ? new Date(right.matchDateTimeUTC).getTime() : 0;
          return rightTime - leftTime;
        });

    const fromFinished = sortRows((finishedQuery.data ?? []).filter((item) => item.isPlayed));
    if (fromFinished.length > 0) {
      return fromFinished;
    }

    return sortRows((fallbackQuery.data ?? []).filter((item) => item.isPlayed));
  }, [fallbackQuery.data, finishedQuery.data]);

  const report = useMemo(() => buildPredictionPerformanceReport(playedItems), [playedItems]);
  const isLoading = finishedQuery.isLoading || fallbackQuery.isLoading;
  const isError = finishedQuery.isError && fallbackQuery.isError && playedItems.length === 0;

  if (isLoading && playedItems.length === 0) {
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
        <h2 className="text-lg font-semibold text-white">Sonuclanan tahmin verisi alinamadi</h2>
        <p className="mt-2 text-sm text-slate-300">Lutfen birkac saniye sonra tekrar deneyin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5">
        <div className="flex items-center gap-2 text-neon-cyan">
          <BarChart3 className="h-4 w-4" />
          <span className="text-xs uppercase tracking-[0.2em]">Sonuclanan Tahmin Analizi</span>
        </div>
        <h1 className="mt-2 text-3xl font-display font-bold text-white">Tahmin Basari Ozeti</h1>
        <p className="mt-2 text-sm text-slate-300">
          Ustte genel basari, altta tahmin turu ve analiz motoru bazli yuzdesel performans gorunur.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">Toplam Tahmin</div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.evaluatedPredictions}</div>
          <div className="mt-1 text-xs text-slate-500">Sonuclanan mac: {report.summary.uniqueMatchCount}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Dogru Tahmin
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.correctPredictions}</div>
        </div>
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <div className="flex items-center gap-2 text-xs text-rose-300">
            <XCircle className="h-4 w-4" />
            Basarisiz Tahmin
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.failedPredictions}</div>
        </div>
        <div className="rounded-xl border border-neon-cyan/20 bg-neon-cyan/5 p-4">
          <div className="flex items-center gap-2 text-xs text-neon-cyan">
            <Target className="h-4 w-4" />
            Genel Basari Orani
          </div>
          <div className="mt-1 text-2xl font-bold text-white">%{report.summary.successRate.toFixed(1)}</div>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Tahmin Turu Basari Oranlari (KG, Skor, IY, MS vb.)</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {report.byType.map((row) => (
            <div key={row.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium text-white">{row.label}</div>
              <div className="mt-1 text-xl font-bold text-neon-cyan">%{row.accuracy.toFixed(1)}</div>
              <div className="mt-2 text-xs text-slate-400">
                Degerlendirilen: {row.evaluated} | Dogru: {row.correct} | Basarisiz: {row.failed}
              </div>
            </div>
          ))}
          {report.byType.length === 0 && <div className="text-sm text-slate-400">Degerlendirilebilir tahmin bulunamadi.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Analiz Motorlarinin Yuzdesel Basarisi</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {report.byEngine.map((row) => (
            <div key={row.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium text-white">{row.label}</div>
              <div className="mt-1 text-xl font-bold text-neon-green">%{row.accuracy.toFixed(1)}</div>
              <div className="mt-2 text-xs text-slate-400">
                Degerlendirilen: {row.evaluated} | Dogru: {row.correct} | Basarisiz: {row.failed}
              </div>
            </div>
          ))}
          {report.byEngine.length === 0 && <div className="text-sm text-slate-400">Motor bazli sonuc olusmadi.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Model Surumu Basari Karsilastirmasi</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-400">
                <th className="py-2 pr-3 font-medium">Model</th>
                <th className="py-2 pr-3 font-medium">Degerlendirilen</th>
                <th className="py-2 pr-3 font-medium">Dogru</th>
                <th className="py-2 pr-3 font-medium">Basarisiz</th>
                <th className="py-2 pr-3 font-medium">Basari</th>
              </tr>
            </thead>
            <tbody>
              {report.byModel.map((row) => (
                <tr key={row.key} className="border-b border-white/5 text-slate-200">
                  <td className="py-2 pr-3">{shortModelId(row.label)}</td>
                  <td className="py-2 pr-3">{row.evaluated}</td>
                  <td className="py-2 pr-3 text-emerald-300">{row.correct}</td>
                  <td className="py-2 pr-3 text-rose-300">{row.failed}</td>
                  <td className="py-2 pr-3 font-semibold text-neon-cyan">%{row.accuracy.toFixed(1)}</td>
                </tr>
              ))}
              {report.byModel.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-slate-400">
                    Model bazli performans verisi yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Sonuclanan Tahmin Listesi</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-400">
                <th className="py-2 pr-3 font-medium">Mac</th>
                <th className="py-2 pr-3 font-medium">Tur</th>
                <th className="py-2 pr-3 font-medium">Tahmin</th>
                <th className="py-2 pr-3 font-medium">Skor</th>
                <th className="py-2 pr-3 font-medium">Durum</th>
              </tr>
            </thead>
            <tbody>
              {playedItems.slice(0, 120).map((item, index) => {
                const verdict = verdictLabel(item);
                const key = `${item.matchId}-${item.predictionType}-${item.marketKey ?? "market"}-${item.line ?? "na"}-${index}`;
                return (
                  <tr key={key} className="border-b border-white/5 text-slate-200">
                    <td className="py-2 pr-3">
                      {item.homeTeam && item.awayTeam ? `${item.homeTeam} vs ${item.awayTeam}` : item.matchId}
                    </td>
                    <td className="py-2 pr-3">{predictionTypeLabel(item.predictionType)}</td>
                    <td className="py-2 pr-3">{pickTopProbabilityLabel(item)}</td>
                    <td className="py-2 pr-3">{asScore(item)}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full border px-2 py-1 text-xs ${verdict.className}`}>{verdict.text}</span>
                    </td>
                  </tr>
                );
              })}
              {playedItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-slate-400">
                    Sonuclanmis tahmin bulunamadi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
