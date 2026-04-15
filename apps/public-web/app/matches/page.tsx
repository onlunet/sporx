import { publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../src/lib/fetch-with-schema";
import { MatchCard, MatchStats } from "../../src/components/matches";
import { Trophy, Calendar } from "lucide-react";

export default async function MatchesPage() {
  let matches: any[] = [];
  let loadError = false;

  try {
    const response = await fetchWithSchema("/api/v1/matches?take=120", publicContract.matchesResponseSchema);
    matches = response.data.slice(0, 24);
  } catch {
    loadError = true;
  }

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-surface via-abyss to-void p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-neon-cyan/10 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-64 w-64 rounded-full bg-neon-purple/10 blur-[80px]" />

        <div className="relative">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple">
              <Trophy className="h-6 w-6 text-void" />
            </div>
            <div>
              <h1 className="gradient-text font-display text-3xl font-bold">Maçlar</h1>
              <p className="text-sm text-slate-400">Tüm futbol karşılaşmaları ve canlı skorlar</p>
            </div>
          </div>

          {loadError ? (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Maç listesi şu anda sınırlı gelebilir. Arka plan servisleri toparlandığında veri otomatik yenilenir.
            </div>
          ) : null}

          <MatchStats matches={matches} />
        </div>
      </div>

      <div>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Calendar className="h-5 w-5 text-neon-cyan" />
            Karşılaşmalar
          </h2>
          <span className="text-sm text-slate-500">{matches.length} maç gösteriliyor</span>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      </div>
    </div>
  );
}
