import { MatchPredictionItem } from "../../features/predictions";

function percent(value?: number) {
  if (value === undefined) {
    return "-";
  }
  return `%${(value * 100).toFixed(1)}`;
}

const matrixKeys = [
  { key: "HH", label: "Ev / Ev" },
  { key: "HD", label: "Ev / Ber." },
  { key: "HA", label: "Ev / Dep." },
  { key: "DH", label: "Ber. / Ev" },
  { key: "DD", label: "Ber. / Ber." },
  { key: "DA", label: "Ber. / Dep." },
  { key: "AH", label: "Dep. / Ev" },
  { key: "AD", label: "Dep. / Ber." },
  { key: "AA", label: "Dep. / Dep." }
];

export function HalfTimeFullTimeMatrix({ prediction }: { prediction?: MatchPredictionItem | null }) {
  const probs = prediction?.probabilities ?? {};

  return (
    <section className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="text-sm font-semibold text-slate-100">İY/MS Olasılık Matrisi</h4>
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

