import { ContradictionSignal } from "../../features/predictions";

export function ContradictionSignalsList({ items }: { items: ContradictionSignal[] }) {
  if (items.length === 0) {
    return <p className="text-xs text-slate-400">Çelişen sinyal bulunmuyor.</p>;
  }

  return (
    <ul className="space-y-2" aria-label="Çelişen sinyaller">
      {items.map((item) => (
        <li key={item.key} className="rounded-md border border-rose-700/50 bg-rose-900/10 p-2 text-xs text-rose-100">
          <p className="font-medium">{item.label}</p>
          {item.detail ? <p className="text-rose-200/90">{item.detail}</p> : null}
          {item.value ? <p className="text-rose-300/90">Değer: {item.value}</p> : null}
        </li>
      ))}
    </ul>
  );
}

