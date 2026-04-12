import { Minus, TrendingUp } from "lucide-react";

interface ComparisonBarProps {
  label: string;
  homeValue: number;
  awayValue: number;
  description?: string;
}

export function ComparisonBar({ label, homeValue, awayValue, description }: ComparisonBarProps) {
  const total = homeValue + awayValue;
  const homePercent = total > 0 ? (homeValue / total) * 100 : 50;
  const awayPercent = total > 0 ? (awayValue / total) * 100 : 50;
  const advantage = homeValue > awayValue ? "home" : awayValue > homeValue ? "away" : "neutral";

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-slate-200">{label}</span>
        <div className="flex items-center gap-2">
          {advantage === "home" ? <TrendingUp className="h-4 w-4 text-neon-cyan" /> : null}
          {advantage === "away" ? <TrendingUp className="h-4 w-4 rotate-180 text-neon-purple" /> : null}
          {advantage === "neutral" ? <Minus className="h-4 w-4 text-slate-500" /> : null}
        </div>
      </div>

      {description ? <p className="text-xs text-slate-500">{description}</p> : null}

      <div className="relative h-3 overflow-hidden rounded-full bg-slate-800">
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-neon-cyan to-neon-cyan/70 transition-all duration-1000"
          style={{ width: `${homePercent}%` }}
        />
        <div
          className="absolute right-0 top-0 h-full bg-gradient-to-l from-neon-purple to-neon-purple/70 transition-all duration-1000"
          style={{ width: `${awayPercent}%` }}
        />
        <div className="absolute left-1/2 top-0 h-full w-0.5 -translate-x-1/2 transform bg-slate-900" />
      </div>

      <div className="flex justify-between text-xs">
        <span className="font-medium text-neon-cyan">{homeValue.toFixed(2)}</span>
        <span className="font-medium text-neon-purple">{awayValue.toFixed(2)}</span>
      </div>
    </div>
  );
}

