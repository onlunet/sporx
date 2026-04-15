import Link from "next/link";
import { publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../src/lib/fetch-with-schema";
import { MatchCard, MatchStats } from "../../src/components/matches";
import { BrainCircuit, Dumbbell, Trophy } from "lucide-react";

export const revalidate = 30;

export default async function BasketballPage() {
  let matches: any[] = [];
  let loadError = false;

  try {
    const response = await fetchWithSchema("/api/v1/matches?sport=basketball&take=120", publicContract.matchesResponseSchema);
    matches = response.data.slice(0, 24);
  } catch {
    loadError = true;
  }

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-surface via-abyss to-void p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-neon-cyan/10 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-64 w-64 rounded-full bg-neon-purple/10 blur-[80px]" />

        <div className="relative space-y-4">
          <div className="mb-3 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple">
              <Dumbbell className="h-6 w-6 text-void" />
            </div>
            <div>
              <h1 className="gradient-text font-display text-3xl font-bold">Basketbol Merkezi</h1>
              <p className="text-sm text-slate-400">Basketbol maçları, canlı durumlar ve model tahmin analizi</p>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/basketball/predictions"
              className="inline-flex items-center gap-2 rounded-lg border border-neon-cyan/30 bg-neon-cyan/10 px-3 py-2 text-xs font-medium text-neon-cyan hover:bg-neon-cyan/20"
            >
              <BrainCircuit className="h-4 w-4" />
              Basketbol Tahminleri
            </Link>
            <Link
              href="/basketball/predictions/completed"
              className="inline-flex items-center gap-2 rounded-lg border border-neon-purple/30 bg-neon-purple/10 px-3 py-2 text-xs font-medium text-neon-purple hover:bg-neon-purple/20"
            >
              <Trophy className="h-4 w-4" />
              Sonuçlanan Basketbol Tahminleri
            </Link>
          </div>

          {loadError ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              Basketbol maç verisi şu anda sınırlı gelebilir. Servis toparlandığında liste otomatik güncellenecek.
            </div>
          ) : null}

          <MatchStats matches={matches} />
        </div>
      </div>

      <section>
        <div className="mb-6 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
            <Dumbbell className="h-5 w-5 text-neon-cyan" />
            Basketbol Maçları
          </h2>
          <span className="text-sm text-slate-500">{matches.length} maç gösteriliyor</span>
        </div>

        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      </section>
    </div>
  );
}
