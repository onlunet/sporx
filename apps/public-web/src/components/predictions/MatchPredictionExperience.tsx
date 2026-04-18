"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import {
  MatchPredictionItem,
  PredictionTabKey,
  groupPredictionsByType,
  getTabAvailability,
  nextAvailableTab,
  useMatchCommentary,
  useMatchPredictions,
  fallbackOverUnderLines,
  predictionSelectionLabel
} from "../../features/predictions";
import { PredictionSummaryBar } from "./PredictionSummaryBar";
import { PredictionTypeTabs } from "./PredictionTypeTabs";
import { FirstHalfResultCard } from "./FirstHalfResultCard";
import { HalfTimeFullTimeMatrix } from "./HalfTimeFullTimeMatrix";
import { BttsPredictionCard } from "./BttsPredictionCard";
import { OverUnderLineSelector } from "./OverUnderLineSelector";
import { OverUnderPredictionCard } from "./OverUnderPredictionCard";
import { PredictionCommentaryPanel } from "./PredictionCommentaryPanel";
import { PredictionConfidenceBadge } from "./PredictionConfidenceBadge";

const ScorelineDistributionCard = dynamic(
  () => import("./ScorelineDistributionCard").then((mod) => ({ default: mod.ScorelineDistributionCard })),
  {
    ssr: false,
    loading: () => <p className="text-xs text-slate-400">Skor dağılımı yükleniyor...</p>
  }
);

type SportScope = "football" | "basketball";

type MatchPredictionExperienceProps = {
  matchId: string;
  initialPrediction?: MatchPredictionItem | null;
  sport?: SportScope;
};

function ProbabilityRow({ label, value }: { label: string; value?: number }) {
  const percent = value !== undefined ? (value * 100).toFixed(1) : null;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-slate-300">{label}</span>
        <span className="font-medium text-slate-100">{percent ? `%${percent}` : "Veri yok"}</span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-slate-800" aria-hidden="true">
        <div className="h-full bg-amber-500/80" style={{ width: `${percent ? Math.max(3, Number(percent)) : 3}%` }} />
      </div>
    </div>
  );
}

function asPct(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return "-";
  }
  return `%${Math.round(value * 100)}`;
}

export function MatchPredictionExperience({ matchId, initialPrediction, sport = "football" }: MatchPredictionExperienceProps) {
  const initial = initialPrediction ? [initialPrediction] : undefined;
  const predictionsQuery = useMatchPredictions(matchId, initial);
  const predictions = useMemo(() => predictionsQuery.data ?? [], [predictionsQuery.data]);
  const grouped = useMemo(() => groupPredictionsByType(predictions), [predictions]);
  const availability = useMemo(() => getTabAvailability(grouped), [grouped]);
  const [activeTab, setActiveTab] = useState<PredictionTabKey>("general");
  const [activeLine, setActiveLine] = useState<number>(2.5);

  useEffect(() => {
    const next = nextAvailableTab(activeTab, availability);
    if (next !== activeTab) {
      setActiveTab(next);
    }
  }, [activeTab, availability]);

  const generalPrediction =
    grouped.fullTimeResult?.[0] ??
    grouped.firstHalfResult?.[0] ??
    grouped.totalGoalsOverUnder?.[0] ??
    grouped.bothTeamsToScore?.[0] ??
    predictions[0];
  const generalSelectionLabel = predictionSelectionLabel(generalPrediction);

  const overUnderItems = fallbackOverUnderLines(grouped.totalGoalsOverUnder ?? []);
  const availableLines = Array.from(
    new Set(overUnderItems.map((item) => item.line).filter((line): line is number => line !== undefined))
  );
  const selectedLinePrediction = overUnderItems.find((item) => item.line === activeLine) ?? overUnderItems[0];
  const scorelinePrediction =
    grouped.correctScore?.find((item) => (item.scorelineDistribution?.length ?? 0) > 0) ??
    predictions.find((item) => (item.scorelineDistribution?.length ?? 0) > 0);
  const commentaryQuery = useMatchCommentary(matchId, activeTab === "commentary");
  const firstHalfPrediction = grouped.firstHalfResult?.[0];
  const fullTimePrediction = grouped.fullTimeResult?.[0] ?? generalPrediction;
  const halfTimeFullTimePrediction = grouped.halfTimeFullTime?.[0];
  const bttsPrediction = grouped.bothTeamsToScore?.[0];
  const firstHalfGoalsPrediction = grouped.firstHalfGoals?.[0];
  const secondHalfGoalsPrediction = grouped.secondHalfGoals?.[0];

  useEffect(() => {
    if (availableLines.length > 0 && !availableLines.includes(activeLine)) {
      setActiveLine(availableLines[0]);
    }
  }, [activeLine, availableLines]);

  if (predictionsQuery.isLoading && predictions.length === 0) {
    return <p className="text-sm text-slate-400">Tahmin detayları yükleniyor...</p>;
  }

  if (predictionsQuery.isError && predictions.length === 0) {
    return (
      <p className="rounded-md border border-rose-700/50 bg-rose-900/20 p-3 text-sm text-rose-200">
        Tahmin detayları şu anda alınamıyor. Kısa süre sonra tekrar deneyebilirsin.
      </p>
    );
  }

  if (predictions.length === 0) {
    return (
      <p className="rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
        Bu maç için henüz yayınlanmış tahmin bulunmuyor.
      </p>
    );
  }

  const probs = generalPrediction?.probabilities ?? {};
  const showOvertime = sport === "basketball" && typeof probs.draw === "number" && probs.draw >= 0.03;

  return (
    <section className="space-y-4">
      <PredictionSummaryBar prediction={generalPrediction} />
      <PredictionTypeTabs activeTab={activeTab} availability={availability} onChange={setActiveTab} />

      <div id={`prediction-panel-${activeTab}`} role="tabpanel" aria-live="polite">
        {activeTab === "general" ? (
          <div className="space-y-3 rounded-md border border-slate-700 bg-slate-900/60 p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-100">
                {sport === "basketball" ? "Basketbol Genel Tahmini" : "Genel Tahmin"}
              </h4>
              <PredictionConfidenceBadge prediction={generalPrediction} />
            </div>
            {generalSelectionLabel ? <p className="text-xs text-neon-amber">Tahmin: {generalSelectionLabel}</p> : null}

            <div className={`grid grid-cols-1 gap-3 ${showOvertime || sport === "football" ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
              <ProbabilityRow label={sport === "basketball" ? "Ev Kazanır" : "Ev Sahibi"} value={generalPrediction?.probabilities?.home} />
              {showOvertime || sport === "football" ? (
                <ProbabilityRow label={sport === "basketball" ? "Uzatma" : "Beraberlik"} value={generalPrediction?.probabilities?.draw} />
              ) : null}
              <ProbabilityRow label={sport === "basketball" ? "Dep. Kazanır" : "Deplasman"} value={generalPrediction?.probabilities?.away} />
            </div>

            <p className="text-sm text-slate-200">{generalPrediction?.summary ?? "Kısa özet verisi bulunmuyor."}</p>

            {generalPrediction?.expectedScore ? (
              <div className="rounded-md border border-white/10 bg-white/5 p-2 text-xs text-slate-300">
                <p>
                  Beklenen skor: {generalPrediction.expectedScore.home?.toFixed(2) ?? "-"} - {generalPrediction.expectedScore.away?.toFixed(2) ?? "-"}
                </p>
                {sport === "basketball" ? (
                  <div className="mt-1 grid gap-1 md:grid-cols-2">
                    <span>Beklenen toplam: {generalPrediction.expectedScore.expectedTotal?.toFixed(1) ?? "-"}</span>
                    <span>
                      Spread (Ev):
                      {generalPrediction.expectedScore.expectedSpreadHome !== undefined
                        ? ` ${generalPrediction.expectedScore.expectedSpreadHome >= 0 ? "+" : ""}${generalPrediction.expectedScore.expectedSpreadHome.toFixed(1)}`
                        : " -"}
                    </span>
                    <span>Beklenen pozisyon: {generalPrediction.expectedScore.expectedPossessions?.toFixed(1) ?? "-"}</span>
                    <span>Pace bandı: {generalPrediction.expectedScore.paceBucket ?? "-"}</span>
                  </div>
                ) : null}
              </div>
            ) : null}

            {generalPrediction?.marketAnalysis ? (
              <div className="rounded-md border border-neon-purple/30 bg-neon-purple/10 p-2 text-xs text-slate-200">
                <p className="font-medium text-neon-purple">Piyasa Karşılaştırması</p>
                <div className="mt-1 grid gap-1 md:grid-cols-2">
                  <span>Model: {asPct(generalPrediction.marketAnalysis.modelProbability)}</span>
                  <span>Piyasa: {asPct(generalPrediction.marketAnalysis.marketImpliedProbability)}</span>
                  <span>
                    Sapma:
                    {generalPrediction.marketAnalysis.probabilityGap !== undefined
                      ? ` %${Math.round(Math.abs(generalPrediction.marketAnalysis.probabilityGap) * 100)}`
                      : " -"}
                  </span>
                  <span>Uyum: {generalPrediction.marketAgreementLevel ?? "-"}</span>
                </div>
              </div>
            ) : null}

            {generalPrediction?.recommendation?.isRecommended !== undefined ? (
              <p className="text-xs text-slate-300">
                Öneri: {generalPrediction.recommendation.isRecommended ? "Evet" : "Temkinli/Pas"}
                {generalPrediction.recommendation.primaryMarket ? ` | Pazar: ${generalPrediction.recommendation.primaryMarket}` : ""}
                {generalPrediction.recommendation.side ? ` | Yön: ${generalPrediction.recommendation.side}` : ""}
              </p>
            ) : null}

            {generalPrediction?.avoidReason ? (
              <p className="rounded-md border border-amber-700/50 bg-amber-900/20 p-2 text-xs text-amber-200">
                Not: {generalPrediction.avoidReason}
              </p>
            ) : null}
          </div>
        ) : null}

        {activeTab === "firstHalfFullTime" ? (
          <div className="space-y-3">
            <FirstHalfResultCard
              prediction={firstHalfPrediction}
              title={sport === "basketball" ? "İlk 2 Periyot Sonucu" : "İlk Yarı Sonucu"}
            />
            <FirstHalfResultCard prediction={fullTimePrediction} title={sport === "basketball" ? "Maç Sonucu" : "Maç Sonucu"} />
            <HalfTimeFullTimeMatrix prediction={halfTimeFullTimePrediction} />
          </div>
        ) : null}

        {activeTab === "btts" ? <BttsPredictionCard prediction={bttsPrediction} /> : null}

        {activeTab === "overUnder" ? (
          <div className="space-y-3 rounded-md border border-slate-700 bg-slate-900/60 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-slate-100">
                {sport === "basketball" ? "Toplam Sayı Alt/Üst Tahmini" : "Alt / Üst Tahmini"}
              </h4>
              <OverUnderLineSelector lines={availableLines} activeLine={activeLine} onChange={setActiveLine} />
            </div>
            <OverUnderPredictionCard prediction={selectedLinePrediction} />
          </div>
        ) : null}

        {activeTab === "scoreline" ? <ScorelineDistributionCard prediction={scorelinePrediction} /> : null}

        {activeTab === "firstHalf" ? (
          <div className="space-y-3">
            <FirstHalfResultCard prediction={firstHalfPrediction} title={sport === "basketball" ? "İlk 2 Periyot Kazananı" : undefined} />
            <OverUnderPredictionCard prediction={firstHalfGoalsPrediction} />
          </div>
        ) : null}

        {activeTab === "secondHalf" ? (
          <div className="space-y-3">
            <OverUnderPredictionCard prediction={secondHalfGoalsPrediction} />
          </div>
        ) : null}

        {activeTab === "commentary" ? (
          <PredictionCommentaryPanel commentary={commentaryQuery.data} prediction={generalPrediction} />
        ) : null}
      </div>
    </section>
  );
}
