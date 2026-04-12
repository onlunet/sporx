import { MatchPredictionItem, riskCodeToTurkish } from "../../features/predictions";
import { AlertTriangle, AlertCircle, Info } from "lucide-react";

function getSeverityConfig(severity: string) {
  switch (severity) {
    case "critical":
      return {
        gradient: "from-neon-red to-rose-500",
        bg: "bg-neon-red/10",
        border: "border-neon-red/30",
        text: "text-neon-red",
        icon: AlertTriangle,
        pulse: true
      };
    case "high":
      return {
        gradient: "from-orange-500 to-red-500",
        bg: "bg-orange-500/10",
        border: "border-orange-500/30",
        text: "text-orange-400",
        icon: AlertTriangle,
        pulse: false
      };
    case "medium":
      return {
        gradient: "from-neon-amber to-yellow-500",
        bg: "bg-neon-amber/10",
        border: "border-neon-amber/30",
        text: "text-neon-amber",
        icon: AlertCircle,
        pulse: false
      };
    default:
      return {
        gradient: "from-slate-500 to-slate-400",
        bg: "bg-slate-500/10",
        border: "border-slate-500/30",
        text: "text-slate-400",
        icon: Info,
        pulse: false
      };
  }
}

export function PredictionRiskBadges({ prediction }: { prediction?: MatchPredictionItem | null }) {
  const riskFlags = prediction?.riskFlags ?? [];
  
  if (riskFlags.length === 0) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-slate-500">
        <div className="w-1.5 h-1.5 rounded-full bg-neon-green" />
        <span>Risk sinyali yok</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {riskFlags.map((risk) => {
        const config = getSeverityConfig(risk.severity);
        const Icon = config.icon;
        
        return (
          <div
            key={`${risk.code}-${risk.message}`}
            className={`
              inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium
              ${config.bg} ${config.text} border ${config.border}
              ${config.pulse ? "animate-pulse" : ""}
            `}
            title={risk.message}
          >
            <Icon className="w-3 h-3" />
            <span>{riskCodeToTurkish(risk.code)}</span>
          </div>
        );
      })}
    </div>
  );
}
