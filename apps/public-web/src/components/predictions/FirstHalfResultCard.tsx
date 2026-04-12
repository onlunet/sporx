import { MatchPredictionItem } from "../../features/predictions";

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
  return (
    <section className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="text-sm font-semibold text-slate-100">{title}</h4>
      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">Ev Sahibi</p>
          <p className="font-medium text-slate-100">{percent(probs?.home)}</p>
        </div>
        <div className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">Beraberlik</p>
          <p className="font-medium text-slate-100">{percent(probs?.draw)}</p>
        </div>
        <div className="rounded-md border border-slate-700 p-2 text-xs">
          <p className="text-slate-400">Deplasman</p>
          <p className="font-medium text-slate-100">{percent(probs?.away)}</p>
        </div>
      </div>
    </section>
  );
}
