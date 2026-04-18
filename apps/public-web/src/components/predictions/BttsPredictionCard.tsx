import { MatchPredictionItem, predictionSelectionLabel } from "../../features/predictions";
import { SupportingSignalsList } from "./SupportingSignalsList";
import { ContradictionSignalsList } from "./ContradictionSignalsList";

function percent(value?: number) {
  if (value === undefined) {
    return "Veri yok";
  }
  return `%${(value * 100).toFixed(1)}`;
}

export function BttsPredictionCard({ prediction }: { prediction?: MatchPredictionItem | null }) {
  const yes = prediction?.probabilities?.yes ?? prediction?.probabilities?.bttsYes;
  const no = prediction?.probabilities?.no ?? prediction?.probabilities?.bttsNo;
  const selectionLabel = predictionSelectionLabel(prediction);

  return (
    <section className="space-y-3 rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="text-sm font-semibold text-slate-100">KG Var/Yok</h4>
      {selectionLabel ? <p className="text-xs text-neon-amber">Tahmin: {selectionLabel}</p> : null}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <article className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">KG Var</p>
          <p className="font-medium text-slate-100">{percent(yes)}</p>
        </article>
        <article className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">KG Yok</p>
          <p className="font-medium text-slate-100">{percent(no)}</p>
        </article>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div>
          <h5 className="mb-2 text-xs uppercase tracking-wide text-slate-400">Destekleyici Sinyaller</h5>
          <SupportingSignalsList items={prediction?.supportingSignals ?? []} />
        </div>
        <div>
          <h5 className="mb-2 text-xs uppercase tracking-wide text-slate-400">Çelişen Sinyaller</h5>
          <ContradictionSignalsList items={prediction?.contradictionSignals ?? []} />
        </div>
      </div>
    </section>
  );
}
