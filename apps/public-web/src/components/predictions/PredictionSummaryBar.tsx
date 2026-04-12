import { MatchPredictionItem, isLowConfidence } from "../../features/predictions";
import { PredictionConfidenceBadge } from "./PredictionConfidenceBadge";
import { PredictionRiskBadges } from "./PredictionRiskBadges";

type PredictionSummaryBarProps = {
  prediction?: MatchPredictionItem | null;
};

export function PredictionSummaryBar({ prediction }: PredictionSummaryBarProps) {
  const updatedAt = prediction?.updatedAt ? new Date(prediction.updatedAt).toLocaleString("tr-TR") : "Bilinmiyor";
  const lowConfidence = isLowConfidence(prediction);

  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900/60 p-4" aria-label="Tahmin özeti">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-slate-400">Tahmin Özeti</p>
          <PredictionConfidenceBadge prediction={prediction} />
        </div>
        <p className="text-xs text-slate-400">Son Güncelleme: {updatedAt}</p>
      </div>

      {lowConfidence ? (
        <p className="mt-3 rounded-md border border-amber-700/60 bg-amber-900/20 p-2 text-xs text-amber-200">
          Bu tahmin düşük güven seviyesinde. Karar verirken ek bağlamı ve güncel takım haberlerini dikkate al.
        </p>
      ) : null}

      <div className="mt-3">
        <PredictionRiskBadges prediction={prediction} />
      </div>
    </section>
  );
}

