import { MatchPredictionItem } from "../../features/predictions";

function confidenceMeta(score?: number) {
  if (score === undefined) {
    return {
      label: "Belirsiz",
      gradient: "from-slate-600 to-slate-500",
      glow: "",
      icon: "?"
    };
  }
  if (score >= 0.75) {
    return {
      label: "Yüksek Güven",
      gradient: "from-neon-green to-emerald-400",
      glow: "shadow-glow-green",
      icon: "★"
    };
  }
  if (score >= 0.6) {
    return {
      label: "İyi Güven",
      gradient: "from-neon-cyan to-cyan-400",
      glow: "shadow-glow-cyan",
      icon: "✓"
    };
  }
  if (score >= 0.5) {
    return {
      label: "Orta Güven",
      gradient: "from-neon-amber to-yellow-400",
      glow: "shadow-glow-amber",
      icon: "~"
    };
  }
  return {
    label: "Düşük Güven",
    gradient: "from-neon-red to-rose-400",
    glow: "shadow-glow-red",
    icon: "!"
  };
}

export function PredictionConfidenceBadge({ prediction }: { prediction?: MatchPredictionItem | null }) {
  const score = prediction?.confidenceScore;
  const meta = confidenceMeta(score);
  
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-gradient-to-r ${meta.gradient} ${meta.glow}`}>
      <span className="text-xs font-display font-bold text-void">{meta.icon}</span>
      <span className="text-xs font-medium text-void">
        {meta.label}
        {score !== undefined && ` ${Math.round(score * 100)}%`}
      </span>
    </div>
  );
}
