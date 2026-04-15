"use client";

import { useMemo } from "react";
import { BarChart3, CheckCircle2, Target, XCircle } from "lucide-react";
import {
  MatchPredictionItem,
  buildPredictionPerformanceReport,
  evaluatePredictionResult,
  isCompletedMatchStatus,
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
  if (key === "over") return `Üst ${item.line ?? ""}`.trim();
  if (key === "under") return `Alt ${item.line ?? ""}`.trim();
  return item.selectionLabel ?? key;
}

function notEvaluatedReason(item: MatchPredictionItem): string {
  const missingFullTimeScore =
    item.homeScore === null || item.homeScore === undefined || item.awayScore === null || item.awayScore === undefined;
  if (missingFullTimeScore) {
    return "Mac skoru eksik";
  }

  const needsHalfTime =
    item.predictionType === "firstHalfResult" ||
    item.predictionType === "halfTimeFullTime" ||
    item.predictionType === "firstHalfGoals" ||
    item.predictionType === "secondHalfGoals";
  const missingHalfTimeScore =
    item.halfTimeHomeScore === null ||
    item.halfTimeHomeScore === undefined ||
    item.halfTimeAwayScore === null ||
    item.halfTimeAwayScore === undefined;

  if (needsHalfTime && missingHalfTimeScore) {
    return "Devre skoru eksik";
  }

  if (!item.probabilities || Object.keys(item.probabilities).length === 0) {
    return "Tahmin olasilik verisi eksik";
  }

  return "Gerekli degerlendirme verisi eksik";
}

function verdictLabel(item: MatchPredictionItem): { text: string; className: string; reason?: string } {
  const result = evaluatePredictionResult(item);
  if (result === true) {
    return { text: "Dogru", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  }
  if (result === false) {
    return { text: "Basarisiz", className: "border-rose-500/30 bg-rose-500/10 text-rose-300" };
  }
  return {
    text: "Degerlendirilemedi",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    reason: notEvaluatedReason(item)
  };
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

type CompletedPredictionsAnalyticsProps = {
  sport?: "football" | "basketball";
};

export function CompletedPredictionsAnalytics({ sport }: CompletedPredictionsAnalyticsProps = {}) {
  const finishedQuery = usePredictionsByType("all", "finished", 300, sport);
  const fallbackQuery = usePredictionsByType("all", undefined, 300, sport);

  const playedItems = useMemo(() => {
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
        <h2 className="text-lg font-semibold text-white">Sonuçlanan tahmin verisi alınamadı</h2>
        <p className="mt-2 text-sm text-slate-300">Lütfen birkaç saniye sonra tekrar deneyin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5">
        <div className="flex items-center gap-2 text-neon-cyan">
          <BarChart3 className="h-4 w-4" />
          <span className="text-xs uppercase tracking-[0.2em]">Sonuçlanan Tahmin Analizi</span>
        </div>
        <h1 className="mt-2 text-3xl font-display font-bold text-white">Tahmin Başarı Özeti</h1>
        <p className="mt-2 text-sm text-slate-300">
          Üstte genel başarı, altta tahmin türü ve analiz motoru bazlı yüzdesel performans görünür.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">Toplam Tahmin</div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.evaluatedPredictions}</div>
          <div className="mt-1 text-xs text-slate-500">Sonuçlanan maç: {report.summary.uniqueMatchCount}</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-2 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            Doğru Tahmin
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.correctPredictions}</div>
        </div>
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <div className="flex items-center gap-2 text-xs text-rose-300">
            <XCircle className="h-4 w-4" />
            Başarısız Tahmin
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{report.summary.failedPredictions}</div>
        </div>
        <div className="rounded-xl border border-neon-cyan/20 bg-neon-cyan/5 p-4">
          <div className="flex items-center gap-2 text-xs text-neon-cyan">
            <Target className="h-4 w-4" />
            Genel Başarı Oranı
          </div>
          <div className="mt-1 text-2xl font-bold text-white">%{report.summary.successRate.toFixed(1)}</div>
        </div>
      </div>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Tahmin Türü Başarı Oranları (KG, Skor, İY, MS vb.)</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {report.byType.map((row) => (
            <div key={row.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium text-white">{row.label}</div>
              <div className="mt-1 text-xl font-bold text-neon-cyan">%{row.accuracy.toFixed(1)}</div>
              <div className="mt-2 text-xs text-slate-400">
                Değerlendirilen: {row.evaluated} | Doğru: {row.correct} | Başarısız: {row.failed}
              </div>
            </div>
          ))}
          {report.byType.length === 0 && <div className="text-sm text-slate-400">Değerlendirilebilir tahmin bulunamadı.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Analiz Motorlarının Yüzdesel Başarısı</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {report.byEngine.map((row) => (
            <div key={row.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium text-white">{row.label}</div>
              <div className="mt-1 text-xl font-bold text-neon-green">%{row.accuracy.toFixed(1)}</div>
              <div className="mt-2 text-xs text-slate-400">
                Değerlendirilen: {row.evaluated} | Doğru: {row.correct} | Başarısız: {row.failed}
              </div>
            </div>
          ))}
          {report.byEngine.length === 0 && <div className="text-sm text-slate-400">Motor bazlı sonuç oluşmadı.</div>}
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Model Sürümü Başarı Karşılaştırması</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-400">
                <th className="py-2 pr-3 font-medium">Model</th>
                <th className="py-2 pr-3 font-medium">Değerlendirilen</th>
                <th className="py-2 pr-3 font-medium">Doğru</th>
                <th className="py-2 pr-3 font-medium">Başarısız</th>
                <th className="py-2 pr-3 font-medium">Başarı</th>
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
                    Model bazlı performans verisi yok.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">Sonuçlanan Tahmin Listesi</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-slate-400">
                <th className="py-2 pr-3 font-medium">Maç</th>
                <th className="py-2 pr-3 font-medium">Tür</th>
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
                      <div className="space-y-1">
                        <span className={`inline-flex rounded-full border px-2 py-1 text-xs ${verdict.className}`}>{verdict.text}</span>
                        {verdict.reason ? <div className="text-xs text-amber-300">{verdict.reason}</div> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {playedItems.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-3 text-slate-400">
                    Sonuçlanmış tahmin bulunamadı.
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


