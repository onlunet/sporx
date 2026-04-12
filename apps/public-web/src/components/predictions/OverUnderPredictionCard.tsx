import { MatchPredictionItem, isLowConfidence } from "../../features/predictions";

function percent(value?: number) {
  if (value === undefined) {
    return "Veri yok";
  }
  return `%${(value * 100).toFixed(1)}`;
}

export function OverUnderPredictionCard({ prediction }: { prediction?: MatchPredictionItem | null }) {
  const over = prediction?.probabilities?.over ?? prediction?.probabilities?.yes;
  const under = prediction?.probabilities?.under ?? prediction?.probabilities?.no;
  const lowConfidence = isLowConfidence(prediction);

  return (
    <section className="space-y-3 rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="text-sm font-semibold text-slate-100">
        Alt / Üst {prediction?.line !== undefined ? `(${prediction.line.toFixed(1)})` : ""}
      </h4>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <article className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">Üst</p>
          <p className="font-medium text-slate-100">{percent(over)}</p>
        </article>
        <article className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">Alt</p>
          <p className="font-medium text-slate-100">{percent(under)}</p>
        </article>
      </div>

      {lowConfidence ? (
        <p className="rounded-md border border-amber-700/50 bg-amber-900/20 p-2 text-xs text-amber-200">
          Bu line için güven seviyesi düşük. Tek başına yorum yerine maç bağlamıyla birlikte değerlendirilmeli.
        </p>
      ) : null}
    </section>
  );
}

