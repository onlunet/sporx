import { SupportingSignal } from "../../features/predictions";

export function SupportingSignalsList({ items }: { items: SupportingSignal[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-slate-400">Destekleyici sinyal bulunmuyor.</p>;
  }

  return (
    <ul className="space-y-2" aria-label="Destekleyici sinyaller">
      {items.map((item) => (
        <li key={item.key} className="rounded-md border border-emerald-700/40 bg-emerald-900/10 p-2 text-xs text-emerald-100">
          <p className="font-medium">{item.label}</p>
          {item.detail ? <p className="text-emerald-200/90">{item.detail}</p> : null}
          {item.value ? <p className="text-emerald-300/90">Değer: {item.value}</p> : null}
        </li>
      ))}
    </ul>
  );
}

