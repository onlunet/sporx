import { History } from "lucide-react";

interface Match {
  id: string;
  matchDateTimeUTC: string;
  homeScore: number | null;
  awayScore: number | null;
  homeTeam: { id?: string; name: string };
  awayTeam: { id?: string; name: string };
  league?: { name: string };
}

interface H2HMatchesProps {
  matches: Match[];
  homeTeamId: string;
}

export function H2HMatches({ matches, homeTeamId }: H2HMatchesProps) {
  if (matches.length === 0) {
    return (
      <div className="glass-card rounded-xl p-6 text-center">
        <History className="mx-auto mb-3 h-12 w-12 text-slate-600" />
        <p className="text-slate-400">Bu iki takım için geçmiş karşılaşma bulunamadı.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {matches.map((match) => {
        const hasScore = match.homeScore !== null && match.awayScore !== null;
        const homeWon = (match.homeScore ?? 0) > (match.awayScore ?? 0);
        const awayWon = (match.awayScore ?? 0) > (match.homeScore ?? 0);
        const draw = hasScore && match.homeScore === match.awayScore;
        const selectedTeamWon =
          hasScore &&
          ((match.homeTeam.id === homeTeamId && homeWon) || (match.awayTeam.id === homeTeamId && awayWon));

        let resultColor = "text-slate-400";
        let resultBg = "bg-slate-800/50";
        let resultText = "Skor Yok";

        if (draw) {
          resultColor = "text-neon-amber";
          resultBg = "bg-neon-amber/10";
          resultText = "Beraberlik";
        } else if (homeWon) {
          resultColor = "text-neon-cyan";
          resultBg = "bg-neon-cyan/10";
          resultText = "Ev Sahibi Kazandı";
        } else if (awayWon) {
          resultColor = "text-neon-purple";
          resultBg = "bg-neon-purple/10";
          resultText = "Deplasman Kazandı";
        }

        return (
          <div key={match.id} className="glass-card rounded-xl p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-xs text-slate-500">{match.league?.name || "Lig bilgisi yok"}</div>
                <div className="flex items-center gap-2 text-sm text-white">
                  <span className="truncate font-medium">{match.homeTeam.name}</span>
                  <span className="text-slate-500">vs</span>
                  <span className="truncate font-medium">{match.awayTeam.name}</span>
                </div>
              </div>

              <div className="text-right">
                <div className="font-display text-2xl font-bold">
                  <span className={homeWon ? "text-neon-cyan" : "text-slate-400"}>{match.homeScore ?? "-"}</span>
                  <span className="mx-2 text-slate-600">:</span>
                  <span className={awayWon ? "text-neon-purple" : "text-slate-400"}>{match.awayScore ?? "-"}</span>
                </div>
                <span className={`rounded px-2 py-0.5 text-xs ${resultBg} ${resultColor}`}>{resultText}</span>
              </div>
            </div>

            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>
                {new Date(match.matchDateTimeUTC).toLocaleDateString("tr-TR", {
                  day: "numeric",
                  month: "long",
                  year: "numeric"
                })}
              </span>
              {selectedTeamWon ? <span className="text-neon-green">Seçili ev takımı perspektifinde olumlu</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

