"use client";

import { useMemo } from "react";
import { BarChart3, CheckCircle2, Target, XCircle, AlertTriangle } from "lucide-react";
import {
  MatchPredictionItem,
  buildPredictionPerformanceReport,
  explainFailedPredictionFactors,
  explainFailedPrediction,
  evaluatePredictionResult,
  isCompletedMatchStatus,
  predictionTypeLabel,
  usePredictionsByType
} from "../../features/predictions";

type SportScope = "football" | "basketball";
type QuarterSource = NonNullable<MatchPredictionItem["quarterBreakdown"]>["source"];

const BASKETBALL_TYPE_LABELS: Partial<Record<MatchPredictionItem["predictionType"], string>> = {
  fullTimeResult: "Maç Kazananı",
  firstHalfResult: "İlk 2 Periyot Kazananı",
  halfTimeFullTime: "Devre/Maç Sonucu",
  bothTeamsToScore: "Takım Skor Üretimi",
  totalGoalsOverUnder: "Toplam Sayı Alt/Üst",
  correctScore: "Skor Dağılımı",
  goalRange: "Sayı Aralığı",
  firstHalfGoals: "İlk 2 Periyot Toplam Sayı",
  secondHalfGoals: "Son 2 Periyot Toplam Sayı"
};

function predictionTypeLabelForSport(type: MatchPredictionItem["predictionType"], sport?: SportScope) {
  if (sport === "basketball") {
    return BASKETBALL_TYPE_LABELS[type] ?? predictionTypeLabel(type);
  }
  return predictionTypeLabel(type);
}

function pickTopProbabilityLabel(item: MatchPredictionItem, sport?: SportScope): string {
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

  if (sport === "basketball") {
    if (key === "home") return "Ev Kazanır";
    if (key === "away") return "Dep. Kazanır";
    if (key === "draw") return "Uzatma / Beraberlik";
    if (key === "over") return `Üst ${item.line ?? ""}`.trim();
    if (key === "under") return `Alt ${item.line ?? ""}`.trim();
    return item.selectionLabel ?? key;
  }

  if (key === "home") return "Ev";
  if (key === "draw") return "Beraberlik";
  if (key === "away") return "Deplasman";
  if (key === "yes" || key === "bttsYes") return "KG Var";
  if (key === "no" || key === "bttsNo") return "KG Yok";
  if (key === "over") return `Üst ${item.line ?? ""}`.trim();
  if (key === "under") return `Alt ${item.line ?? ""}`.trim();
  return item.selectionLabel ?? key;
}

function totalPoints(item: MatchPredictionItem): number | null {
  if (item.homeScore === null || item.homeScore === undefined || item.awayScore === null || item.awayScore === undefined) {
    return null;
  }
  return item.homeScore + item.awayScore;
}

function quarterBreakdownSummary(item: MatchPredictionItem): string | null {
  const quarter = item.quarterBreakdown;
  if (!quarter) {
    return null;
  }
  return `Q1 ${quarter.q1.home}-${quarter.q1.away} | Q2 ${quarter.q2.home}-${quarter.q2.away} | Q3 ${quarter.q3.home}-${quarter.q3.away} | Q4 ${quarter.q4.home}-${quarter.q4.away}`;
}

function quarterSourceLabel(source?: QuarterSource) {
  if (source === "provider_period_scores") {
    return "Kaynak: provider periyot skor verisi";
  }
  if (source === "projected") {
    return "Kaynak: model projeksiyonu";
  }
  return "Kaynak: skor tabanlı tahmini dağılım";
}

function notEvaluatedReason(item: MatchPredictionItem, sport?: SportScope): string {
  const missingFullTimeScore =
    item.homeScore === null || item.homeScore === undefined || item.awayScore === null || item.awayScore === undefined;
  if (missingFullTimeScore) {
    return sport === "basketball" ? "Maç sonu sayı verisi eksik" : "Maç skoru eksik";
  }

  const needsHalfTime =
    item.predictionType === "firstHalfResult" ||
    item.predictionType === "halfTimeFullTime" ||
    item.predictionType === "firstHalfGoals" ||
    item.predictionType === "secondHalfGoals";
  const missingHalfTimeScore =
    (item.halfTimeHomeScore === null ||
      item.halfTimeHomeScore === undefined ||
      item.halfTimeAwayScore === null ||
      item.halfTimeAwayScore === undefined) &&
    !item.quarterBreakdown;

  if (needsHalfTime && missingHalfTimeScore) {
    return sport === "basketball" ? "İlk 2 periyot skoru eksik" : "Devre skoru eksik";
  }

  if (!item.probabilities || Object.keys(item.probabilities).length === 0) {
    return "Tahmin olasılık verisi eksik";
  }

  return "Gerekli değerlendirme verisi eksik";
}

function verdictLabel(item: MatchPredictionItem, sport?: SportScope): { text: string; className: string; reason?: string } {
  const result = evaluatePredictionResult(item);
  if (result === true) {
    return { text: "Doğru", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  }
  if (result === false) {
    return {
      text: "Başarısız",
      className: "border-rose-500/30 bg-rose-500/10 text-rose-300",
      reason: explainFailedPrediction(item) ?? "Tahmin sonucu gerçekle uyuşmadı"
    };
  }
  return {
    text: "Değerlendirilemedi",
    className: "border-slate-500/30 bg-slate-500/10 text-slate-300",
    reason: notEvaluatedReason(item, sport)
  };
}

function failureFactors(item: MatchPredictionItem): string[] {
  return evaluatePredictionResult(item) === false ? explainFailedPredictionFactors(item) : [];
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
  sport?: SportScope;
};

function toPercent(value: number, digits = 1) {
  if (!Number.isFinite(value)) {
    return "0.0";
  }
  return value.toFixed(digits);
}

export function CompletedPredictionsAnalytics({ sport }: CompletedPredictionsAnalyticsProps = {}) {
  const finishedQuery = usePredictionsByType("all", "finished", 180, sport);

  const playedItems = useMemo(() => {
    const sortRows = (rows: MatchPredictionItem[]) =>
      rows
        .slice()
        .sort((left, right) => {
          const leftTime = left.matchDateTimeUTC ? new Date(left.matchDateTimeUTC).getTime() : 0;
          const rightTime = right.matchDateTimeUTC ? new Date(right.matchDateTimeUTC).getTime() : 0;
          return rightTime - leftTime;
        });

    return sortRows((finishedQuery.data ?? []).filter((item) => isCompletedMatchStatus(item.matchStatus)));
  }, [finishedQuery.data]);

  const evaluatedItems = useMemo(() => playedItems.filter((item) => evaluatePredictionResult(item) !== null), [playedItems]);
  const notEvaluatedItems = useMemo(() => playedItems.filter((item) => evaluatePredictionResult(item) === null), [playedItems]);
  const report = useMemo(() => buildPredictionPerformanceReport(evaluatedItems), [evaluatedItems]);

  const basketballScoreStats = useMemo(() => {
    if (sport !== "basketball") {
      return null;
    }
    const totals = playedItems.map((item) => totalPoints(item)).filter((value): value is number => value !== null);
    if (totals.length === 0) {
      return {
        average: null as number | null,
        min: null as number | null,
        max: null as number | null
      };
    }
    const sum = totals.reduce((acc, value) => acc + value, 0);
    return {
      average: sum / totals.length,
      min: Math.min(...totals),
      max: Math.max(...totals)
    };
  }, [playedItems, sport]);

  const basketballMarketStats = useMemo(() => {
    if (sport !== "basketball") {
      return null;
    }

    const marketRows = evaluatedItems.filter(
      (item) => item.marketAnalysis && typeof item.marketAnalysis.probabilityGap === "number"
    );

    if (marketRows.length === 0) {
      return {
        coverageRate: 0,
        sampleSize: 0,
        avgAbsGap: 0,
        avgContradiction: 0,
        alignmentRate: 0,
        disagreementRate: 0,
        alignmentAccuracy: 0,
        disagreementAccuracy: 0,
        byType: [] as Array<{
          type: MatchPredictionItem["predictionType"];
          sampleSize: number;
          avgAbsGap: number;
          alignmentRate: number;
          disagreementRate: number;
          accuracy: number;
        }>
      };
    }

    const alignmentThreshold = 0.08;
    const disagreementThreshold = 0.18;
    const contradictionThreshold = 0.25;

    let absGapTotal = 0;
    let contradictionTotal = 0;
    let aligned = 0;
    let disagreed = 0;
    let alignedCorrect = 0;
    let alignedEvaluated = 0;
    let disagreedCorrect = 0;
    let disagreedEvaluated = 0;

    const byTypeMap = new Map<
      MatchPredictionItem["predictionType"],
      { sample: number; absGapTotal: number; aligned: number; disagreed: number; correct: number; evaluated: number }
    >();

    for (const item of marketRows) {
      const gap = Math.abs(item.marketAnalysis?.probabilityGap ?? 0);
      const contradictionScore = Math.max(0, item.marketAnalysis?.contradictionScore ?? 0);
      const result = evaluatePredictionResult(item);
      const isAligned = gap <= alignmentThreshold;
      const isDisagreed = gap >= disagreementThreshold || contradictionScore >= contradictionThreshold;

      absGapTotal += gap;
      contradictionTotal += contradictionScore;

      if (isAligned) {
        aligned += 1;
        if (result !== null) {
          alignedEvaluated += 1;
          if (result === true) {
            alignedCorrect += 1;
          }
        }
      }

      if (isDisagreed) {
        disagreed += 1;
        if (result !== null) {
          disagreedEvaluated += 1;
          if (result === true) {
            disagreedCorrect += 1;
          }
        }
      }

      const row = byTypeMap.get(item.predictionType) ?? {
        sample: 0,
        absGapTotal: 0,
        aligned: 0,
        disagreed: 0,
        correct: 0,
        evaluated: 0
      };
      row.sample += 1;
      row.absGapTotal += gap;
      if (isAligned) {
        row.aligned += 1;
      }
      if (isDisagreed) {
        row.disagreed += 1;
      }
      if (result !== null) {
        row.evaluated += 1;
        if (result === true) {
          row.correct += 1;
        }
      }
      byTypeMap.set(item.predictionType, row);
    }

    const byType = Array.from(byTypeMap.entries())
      .map(([type, row]) => ({
        type,
        sampleSize: row.sample,
        avgAbsGap: row.sample > 0 ? row.absGapTotal / row.sample : 0,
        alignmentRate: row.sample > 0 ? (row.aligned / row.sample) * 100 : 0,
        disagreementRate: row.sample > 0 ? (row.disagreed / row.sample) * 100 : 0,
        accuracy: row.evaluated > 0 ? (row.correct / row.evaluated) * 100 : 0
      }))
      .sort((left, right) => right.sampleSize - left.sampleSize);

    return {
      coverageRate: evaluatedItems.length > 0 ? (marketRows.length / evaluatedItems.length) * 100 : 0,
      sampleSize: marketRows.length,
      avgAbsGap: absGapTotal / marketRows.length,
      avgContradiction: contradictionTotal / marketRows.length,
      alignmentRate: (aligned / marketRows.length) * 100,
      disagreementRate: (disagreed / marketRows.length) * 100,
      alignmentAccuracy: alignedEvaluated > 0 ? (alignedCorrect / alignedEvaluated) * 100 : 0,
      disagreementAccuracy: disagreedEvaluated > 0 ? (disagreedCorrect / disagreedEvaluated) * 100 : 0,
      byType
    };
  }, [evaluatedItems, sport]);

  const isLoading = finishedQuery.isLoading;
  const isError = finishedQuery.isError && playedItems.length === 0;

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

  const title = sport === "basketball" ? "Basketbol Tahmin Başarı Özeti" : "Tahmin Başarı Özeti";
  const subtitle =
    sport === "basketball"
      ? "Basketbolda 4 periyot yapısı esas alınır: ilk yarı = Q1+Q2, ikinci yarı = Q3+Q4."
      : "Üstte genel başarı, altta tahmin türü ve analiz motoru bazlı yüzdesel performans görünür.";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-white/10 bg-surface/60 p-5">
        <div className="flex items-center gap-2 text-neon-cyan">
          <BarChart3 className="h-4 w-4" />
          <span className="text-xs uppercase tracking-[0.2em]">Sonuçlanan Tahmin Analizi</span>
        </div>
        <h1 className="mt-2 text-3xl font-display font-bold text-white">{title}</h1>
        <p className="mt-2 text-sm text-slate-300">{subtitle}</p>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs text-slate-400">Toplam Değerlendirilen</div>
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
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-xs text-amber-300">
            <AlertTriangle className="h-4 w-4" />
            Değerlendirilemeyen
          </div>
          <div className="mt-1 text-2xl font-bold text-white">{notEvaluatedItems.length}</div>
        </div>
      </div>

      {sport === "basketball" ? (
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-slate-400">Ort. Toplam Sayı</div>
            <div className="mt-1 text-2xl font-bold text-white">
              {basketballScoreStats?.average !== null && basketballScoreStats?.average !== undefined
                ? basketballScoreStats.average.toFixed(1)
                : "-"}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-slate-400">En Düşük Toplam Sayı</div>
            <div className="mt-1 text-2xl font-bold text-white">
              {basketballScoreStats?.min !== null && basketballScoreStats?.min !== undefined
                ? basketballScoreStats.min.toFixed(0)
                : "-"}
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <div className="text-xs text-slate-400">En Yüksek Toplam Sayı</div>
            <div className="mt-1 text-2xl font-bold text-white">
              {basketballScoreStats?.max !== null && basketballScoreStats?.max !== undefined
                ? basketballScoreStats.max.toFixed(0)
                : "-"}
            </div>
          </div>
        </div>
      ) : null}

      {sport === "basketball" ? (
        <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
          <h2 className="text-lg font-semibold text-white">Model - Piyasa Uyumu (Basketbol)</h2>
          <p className="mt-1 text-xs text-slate-400">
            Bu bölüm model olasılıkları ile piyasa implied olasılıklarının ne kadar aynı yönde olduğunu ve sonuçla ilişkisini gösterir.
          </p>

          <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-slate-400">Piyasa Kapsamı</div>
              <div className="mt-1 text-xl font-bold text-neon-cyan">%{toPercent(basketballMarketStats?.coverageRate ?? 0)}</div>
              <div className="mt-1 text-[11px] text-slate-500">Örnek: {basketballMarketStats?.sampleSize ?? 0}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-slate-400">Ort. Mutlak Sapma</div>
              <div className="mt-1 text-xl font-bold text-white">%{toPercent((basketballMarketStats?.avgAbsGap ?? 0) * 100, 2)}</div>
              <div className="mt-1 text-[11px] text-slate-500">|model - piyasa|</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <div className="text-xs text-slate-400">Ort. Çelişki Skoru</div>
              <div className="mt-1 text-xl font-bold text-white">{toPercent(basketballMarketStats?.avgContradiction ?? 0, 2)}</div>
              <div className="mt-1 text-[11px] text-slate-500">0 = uyumlu, 1 = çelişkili</div>
            </div>
            <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3">
              <div className="text-xs text-emerald-300">Uyumlu Sinyal Oranı</div>
              <div className="mt-1 text-xl font-bold text-white">%{toPercent(basketballMarketStats?.alignmentRate ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-3">
              <div className="text-xs text-rose-300">Çelişkili Sinyal Oranı</div>
              <div className="mt-1 text-xl font-bold text-white">%{toPercent(basketballMarketStats?.disagreementRate ?? 0)}</div>
            </div>
            <div className="rounded-xl border border-neon-cyan/20 bg-neon-cyan/5 p-3">
              <div className="text-xs text-neon-cyan">Uyumlu Sinyalde Doğruluk</div>
              <div className="mt-1 text-xl font-bold text-white">%{toPercent(basketballMarketStats?.alignmentAccuracy ?? 0)}</div>
              <div className="mt-1 text-[11px] text-slate-500">
                Çelişkili sinyalde: %{toPercent(basketballMarketStats?.disagreementAccuracy ?? 0)}
              </div>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-slate-400">
                  <th className="py-2 pr-3 font-medium">Tahmin Türü</th>
                  <th className="py-2 pr-3 font-medium">Örnek</th>
                  <th className="py-2 pr-3 font-medium">Ort. Sapma</th>
                  <th className="py-2 pr-3 font-medium">Uyumlu (%)</th>
                  <th className="py-2 pr-3 font-medium">Çelişkili (%)</th>
                  <th className="py-2 pr-3 font-medium">Doğruluk (%)</th>
                </tr>
              </thead>
              <tbody>
                {(basketballMarketStats?.byType ?? []).map((row) => (
                  <tr key={row.type} className="border-b border-white/5 text-slate-200">
                    <td className="py-2 pr-3">{predictionTypeLabelForSport(row.type, sport)}</td>
                    <td className="py-2 pr-3">{row.sampleSize}</td>
                    <td className="py-2 pr-3">%{toPercent(row.avgAbsGap * 100, 2)}</td>
                    <td className="py-2 pr-3 text-emerald-300">%{toPercent(row.alignmentRate)}</td>
                    <td className="py-2 pr-3 text-rose-300">%{toPercent(row.disagreementRate)}</td>
                    <td className="py-2 pr-3 text-neon-cyan">%{toPercent(row.accuracy)}</td>
                  </tr>
                ))}
                {(basketballMarketStats?.byType.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-3 text-slate-400">
                      Piyasa analizi verisi henüz oluşmamış.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-4">
        <h2 className="text-lg font-semibold text-white">
          {sport === "basketball" ? "Tahmin Türü Başarı Oranları (Kazananı, Toplam Sayı, Periyot vb.)" : "Tahmin Türü Başarı Oranları (KG, Skor, İY, MS vb.)"}
        </h2>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {report.byType.map((row) => (
            <div key={row.key} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="text-sm font-medium text-white">{predictionTypeLabelForSport(row.key as MatchPredictionItem["predictionType"], sport)}</div>
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
                {sport === "basketball" ? <th className="py-2 pr-3 font-medium">Toplam Sayı</th> : null}
                {sport === "basketball" ? <th className="py-2 pr-3 font-medium">4 Periyot Dağılımı</th> : null}
                <th className="py-2 pr-3 font-medium">Neden Şaştı?</th>
                <th className="py-2 pr-3 font-medium">Durum</th>
              </tr>
            </thead>
            <tbody>
              {playedItems.slice(0, 120).map((item, index) => {
                const verdict = verdictLabel(item, sport);
                const factors = failureFactors(item);
                const key = `${item.matchId}-${item.predictionType}-${item.marketKey ?? "market"}-${item.line ?? "na"}-${index}`;
                return (
                  <tr key={key} className="border-b border-white/5 text-slate-200">
                    <td className="py-2 pr-3">
                      {item.homeTeam && item.awayTeam ? `${item.homeTeam} vs ${item.awayTeam}` : item.matchId}
                    </td>
                    <td className="py-2 pr-3">{predictionTypeLabelForSport(item.predictionType, sport)}</td>
                    <td className="py-2 pr-3">{pickTopProbabilityLabel(item, sport)}</td>
                    <td className="py-2 pr-3">{asScore(item)}</td>
                    {sport === "basketball" ? <td className="py-2 pr-3">{totalPoints(item) ?? "-"}</td> : null}
                    {sport === "basketball" ? (
                      <td className="py-2 pr-3 text-xs text-slate-300">
                        {quarterBreakdownSummary(item) ?? "-"}
                        {item.quarterBreakdown ? (
                          <div className="mt-1 text-[10px] text-slate-500">
                            {quarterSourceLabel(item.quarterBreakdown.source)}
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                    <td className="py-2 pr-3">
                      {factors.length > 0 ? (
                        <div className="space-y-1">
                          {factors.map((factor, factorIndex) => (
                            <div
                              key={`${key}-factor-${factorIndex}`}
                              className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-2 py-1 text-xs text-amber-100"
                            >
                              {factor}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">-</span>
                      )}
                    </td>
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
                  <td colSpan={sport === "basketball" ? 8 : 6} className="py-3 text-slate-400">
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
