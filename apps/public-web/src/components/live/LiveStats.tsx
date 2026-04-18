import { Activity, Zap, TrendingUp } from "lucide-react";

interface LiveStatsProps {
  matches: Array<{ predictions: unknown[]; score: { home: number | null; away: number | null } }>;
  matchLabel?: string;
  scoreLabel?: string;
}

export function LiveStats({ matches, matchLabel = "Canlı Maç", scoreLabel = "Toplam Gol" }: LiveStatsProps) {
  const totalMatches = matches.length;
  const withPredictions = matches.filter((m) => m.predictions.length > 0).length;
  const totalScore = matches.reduce((acc, m) => acc + (m.score.home ?? 0) + (m.score.away ?? 0), 0);

  return (
    <div className="grid grid-cols-3 gap-4">
      <div className="glass-card rounded-xl border-neon-red/20 p-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-neon-red/20">
          <Activity className="h-5 w-5 text-neon-red" />
        </div>
        <div className="text-2xl font-bold text-white">{totalMatches}</div>
        <div className="text-xs text-slate-400">{matchLabel}</div>
      </div>

      <div className="glass-card rounded-xl p-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-neon-cyan/20">
          <Zap className="h-5 w-5 text-neon-cyan" />
        </div>
        <div className="text-2xl font-bold text-white">{withPredictions}</div>
        <div className="text-xs text-slate-400">Tahminli</div>
      </div>

      <div className="glass-card rounded-xl p-4 text-center">
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-neon-amber/20">
          <TrendingUp className="h-5 w-5 text-neon-amber" />
        </div>
        <div className="text-2xl font-bold text-white">{totalScore}</div>
        <div className="text-xs text-slate-400">{scoreLabel}</div>
      </div>
    </div>
  );
}
