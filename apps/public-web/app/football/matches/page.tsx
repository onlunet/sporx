import { publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../../src/lib/fetch-with-schema";
import { MatchCard, MatchStats } from "../../../src/components/matches";
import { Calendar, Swords } from "lucide-react";

export const revalidate = 30;

export default async function FootballMatchesPage() {
  let matches: any[] = [];
  let loadError = false;

  try {
    const response = await fetchWithSchema("/api/v1/matches?sport=football&take=120", publicContract.matchesResponseSchema);
    matches = response.data.slice(0, 24);
  } catch {
    loadError = true;
  }

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10 bg-gradient-to-br from-surface via-abyss to-void p-5 sm:p-6 lg:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 sm:h-96 sm:w-96 rounded-full bg-neon-cyan/10 blur-[80px] sm:blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-48 w-48 sm:h-64 sm:w-64 rounded-full bg-neon-purple/10 blur-[60px] sm:blur-[80px]" />

        <div className="relative">
          <div className="mb-3 sm:mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple">
              <Swords className="h-5 w-5 sm:h-6 sm:w-6 text-void" />
            </div>
            <div>
              <h1 className="gradient-text font-display text-2xl sm:text-3xl font-bold">Futbol Maclari</h1>
              <p className="text-xs sm:text-sm text-slate-400">Futbol karsilasmalari, skorlar ve mac detaylari</p>
            </div>
          </div>

          {loadError ? (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Futbol mac listesi su an sinirli gelebilir. Veri akisi toparlandiginda otomatik guncellenecek.
            </div>
          ) : null}

          <MatchStats matches={matches} />
        </div>
      </div>

      <div>
        <div className="mb-4 sm:mb-6 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base sm:text-lg font-semibold text-white">
            <Calendar className="h-5 w-5 text-neon-cyan" />
            Karsilasmalar
          </h2>
          <span className="text-xs sm:text-sm text-slate-500">{matches.length} mac gosteriliyor</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      </div>
    </div>
  );
}
