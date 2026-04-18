import { MatchPredictionItem, predictionSelectionLabel } from "../../features/predictions";

function percent(value?: number) {
  if (value === undefined) {
    return "-";
  }
  return `%${(value * 100).toFixed(1)}`;
}

const matrixKeys = [
  { key: "HH", label: "1/1" },
  { key: "HD", label: "1/X" },
  { key: "HA", label: "1/2" },
  { key: "DH", label: "X/1" },
  { key: "DD", label: "X/X" },
  { key: "DA", label: "X/2" },
  { key: "AH", label: "2/1" },
  { key: "AD", label: "2/X" },
  { key: "AA", label: "2/2" }
];

export function HalfTimeFullTimeMatrix({ prediction }: { prediction?: MatchPredictionItem | null }) {
  const probs = prediction?.probabilities ?? {};
  const selectionLabel = predictionSelectionLabel(prediction);

  return (
    <section className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="text-sm font-semibold text-slate-100">İY/MS Olasılık Matrisi</h4>
      {selectionLabel ? <p className="mt-1 text-xs text-neon-amber">Tahmin: {selectionLabel}</p> : null}
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        {matrixKeys.map((item) => (
          <article key={item.key} className="rounded-md border border-slate-700 p-2 text-xs">
            <p className="text-slate-400">{item.label}</p>
            <p className="font-medium text-slate-100">{percent(probs[item.key])}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
