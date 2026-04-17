interface Probability {
  home: number;
  draw: number;
  away: number;
}

interface ProbabilityDisplayProps {
  probabilities: Probability;
  homeTeam: string;
  awayTeam: string;
}

export function ProbabilityDisplay({ probabilities, homeTeam, awayTeam }: ProbabilityDisplayProps) {
  const maxProb = Math.max(probabilities.home, probabilities.draw, probabilities.away);

  return (
    <div className="grid grid-cols-3 gap-4">
      <div
        className={`glass-card rounded-xl p-4 text-center transition-all ${
          maxProb === probabilities.home ? "ring-2 ring-neon-cyan/50 shadow-glow-cyan/20" : ""
        }`}
      >
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-neon-cyan/20">
          <span className="text-lg font-bold text-neon-cyan">E</span>
        </div>
        <div className="text-xl sm:text-2xl font-bold text-white">%{Math.round(probabilities.home * 100)}</div>
        <div className="mt-1 truncate text-xs text-slate-400">{homeTeam}</div>
        <div className="mt-1 text-[10px] text-neon-cyan">Ev Sahibi Kazanır</div>
      </div>

      <div
        className={`glass-card rounded-xl p-4 text-center transition-all ${
          maxProb === probabilities.draw ? "ring-2 ring-neon-amber/50 shadow-glow-amber/20" : ""
        }`}
      >
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-neon-amber/20">
          <span className="text-lg font-bold text-neon-amber">B</span>
        </div>
        <div className="text-xl sm:text-2xl font-bold text-white">%{Math.round(probabilities.draw * 100)}</div>
        <div className="mt-1 text-xs text-slate-400">Beraberlik</div>
        <div className="mt-1 text-[10px] text-neon-amber">Dengeli Senaryo</div>
      </div>

      <div
        className={`glass-card rounded-xl p-4 text-center transition-all ${
          maxProb === probabilities.away ? "ring-2 ring-neon-purple/50 shadow-glow-purple/20" : ""
        }`}
      >
        <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-neon-purple/20">
          <span className="text-lg font-bold text-neon-purple">D</span>
        </div>
        <div className="text-xl sm:text-2xl font-bold text-white">%{Math.round(probabilities.away * 100)}</div>
        <div className="mt-1 truncate text-xs text-slate-400">{awayTeam}</div>
        <div className="mt-1 text-[10px] text-neon-purple">Deplasman Kazanır</div>
      </div>
    </div>
  );
}

