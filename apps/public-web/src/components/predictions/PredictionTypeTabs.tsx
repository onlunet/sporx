import { PREDICTION_TABS, PredictionTabKey } from "../../features/predictions";

type PredictionTypeTabsProps = {
  activeTab: PredictionTabKey;
  availability: Record<PredictionTabKey, boolean>;
  onChange: (tab: PredictionTabKey) => void;
};

export function PredictionTypeTabs({ activeTab, availability, onChange }: PredictionTypeTabsProps) {
  return (
    <div className="overflow-x-auto">
      <div className="flex min-w-max gap-2 pb-2" role="tablist" aria-label="Tahmin sekmeleri">
        {PREDICTION_TABS.map((tab) => {
          const isActive = tab.key === activeTab;
          const disabled = !availability[tab.key];
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-controls={`prediction-panel-${tab.key}`}
              disabled={disabled}
              onClick={() => onChange(tab.key)}
              className={`rounded-md border px-3 py-2 text-sm transition ${
                isActive
                  ? "border-amber-500 bg-amber-500/15 text-amber-100"
                  : "border-slate-700 bg-slate-900/60 text-slate-200 hover:bg-slate-800"
              } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

