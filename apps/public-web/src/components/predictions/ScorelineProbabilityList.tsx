import { ScorelineDistributionItem } from "../../features/predictions";

type ScorelineProbabilityListProps = {
  items: ScorelineDistributionItem[];
  limit?: number;
};

export function ScorelineProbabilityList({ items, limit = 10 }: ScorelineProbabilityListProps) {
  const visible = items.slice(0, limit);
  if (visible.length === 0) {
    return <p className="text-xs text-slate-400">Skor dağılımı verisi bulunmuyor.</p>;
  }

  return (
    <ul className="space-y-2">
      {visible.map((item) => (
        <li key={item.label} className="rounded-md border border-slate-700 p-2 text-xs">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-slate-100">{item.label}</span>
            <span className="font-medium text-slate-100">%{(item.probability * 100).toFixed(1)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-800" aria-hidden="true">
            <div className="h-full bg-cyan-500/80" style={{ width: `${Math.max(3, item.probability * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

