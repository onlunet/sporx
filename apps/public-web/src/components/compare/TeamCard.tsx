import { Shield } from "lucide-react";

interface TeamCardProps {
  team: { name: string; country?: string | null } | undefined;
  color: "cyan" | "purple";
  isHome: boolean;
}

export function TeamCard({ team, color, isHome }: TeamCardProps) {
  if (!team) {
    return (
      <div className="glass-card rounded-xl p-6 text-center opacity-50">
        <Shield className="mx-auto mb-3 h-12 w-12 text-slate-600" />
        <p className="text-slate-500">Takım seçilmedi</p>
      </div>
    );
  }

  const colorClasses = {
    cyan: {
      bg: "from-neon-cyan/20 to-neon-cyan/5",
      border: "border-neon-cyan/30",
      icon: "text-neon-cyan",
      glow: "shadow-glow-cyan/20"
    },
    purple: {
      bg: "from-neon-purple/20 to-neon-purple/5",
      border: "border-neon-purple/30",
      icon: "text-neon-purple",
      glow: "shadow-glow-purple/20"
    }
  };

  return (
    <div className={`glass-card rounded-xl border p-6 ${colorClasses[color].border} ${colorClasses[color].glow}`}>
      <div
        className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br ${colorClasses[color].bg}`}
      >
        <Shield className={`h-10 w-10 ${colorClasses[color].icon}`} />
      </div>
      <h3 className="text-center text-xl font-bold text-white">{team.name}</h3>

      {team.country ? <p className="mt-1 text-center text-sm text-slate-400">{team.country}</p> : null}

      <div className="mt-4 flex items-center justify-center gap-2">
        <span
          className={`rounded-full px-2 py-1 text-xs ${
            isHome ? "bg-neon-cyan/20 text-neon-cyan" : "bg-neon-purple/20 text-neon-purple"
          }`}
        >
          {isHome ? "EV SAHİBİ" : "DEPLASMAN"}
        </span>
      </div>
    </div>
  );
}

