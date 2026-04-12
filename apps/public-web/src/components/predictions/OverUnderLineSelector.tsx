type OverUnderLineSelectorProps = {
  lines: number[];
  activeLine: number;
  onChange: (line: number) => void;
};

export function OverUnderLineSelector({ lines, activeLine, onChange }: OverUnderLineSelectorProps) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Alt üst çizgisi seçimi">
      {lines.map((line) => {
        const isActive = line === activeLine;
        return (
          <button
            key={line}
            type="button"
            onClick={() => onChange(line)}
            className={`rounded-md border px-3 py-1.5 text-xs ${
              isActive
                ? "border-cyan-500 bg-cyan-500/15 text-cyan-100"
                : "border-slate-700 bg-slate-900/70 text-slate-200 hover:bg-slate-800"
            }`}
            aria-pressed={isActive}
          >
            {line.toFixed(1)}
          </button>
        );
      })}
    </div>
  );
}

