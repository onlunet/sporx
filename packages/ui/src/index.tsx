import type { ReactNode } from "react";

export function SectionCard(props: { title: string; children: ReactNode; subtitle?: string }) {
  return (
    <section className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
      <header className="mb-2">
        <h2 className="text-base font-semibold text-slate-100">{props.title}</h2>
        {props.subtitle ? <p className="text-sm text-slate-400">{props.subtitle}</p> : null}
      </header>
      <div>{props.children}</div>
    </section>
  );
}

export function MetricChip(props: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-slate-600 px-3 py-2 text-xs text-slate-200">
      <p className="text-slate-400">{props.label}</p>
      <p className="font-semibold">{props.value}</p>
    </div>
  );
}
