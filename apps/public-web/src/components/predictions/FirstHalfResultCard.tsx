import { MatchPredictionItem, predictionSelectionLabel } from "../../features/predictions";

function percent(value?: number) {
  if (value === undefined) {
    return "Veri yok";
  }
  return `%${(value * 100).toFixed(1)}`;
}

export function FirstHalfResultCard({
  prediction,
  title = "İlk Yarı Sonucu"
}: {
  prediction?: MatchPredictionItem | null;
  title?: string;
}) {
  const probs = prediction?.probabilities;
  const selectionLabel = predictionSelectionLabel(prediction);
  return (
    <section className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="text-sm font-semibold text-slate-100">{title}</h4>
      {selectionLabel ? <p className="mt-1 text-xs text-neon-amber">Tahmin: {selectionLabel}</p> : null}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">1</p>
          <p className="font-medium text-slate-100">{percent(probs?.home)}</p>
        </div>
        <div className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">X</p>
          <p className="font-medium text-slate-100">{percent(probs?.draw)}</p>
        </div>
        <div className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">2</p>
          <p className="font-medium text-slate-100">{percent(probs?.away)}</p>
        </div>
      </div>
    </section>
  );
}
