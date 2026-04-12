import { publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../src/lib/fetch-with-schema";
import { MatchCard, MatchStats } from "../../src/components/matches";
import { Trophy, Calendar } from "lucide-react";

export default async function MatchesPage() {
  const response = await fetchWithSchema("/api/v1/matches", publicContract.matchesResponseSchema);
  const matches = response.data.slice(0, 24);
  
  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-surface via-abyss to-void border border-white/10 p-8">
        <div className="absolute top-0 right-0 w-96 h-96 bg-neon-cyan/10 rounded-full blur-[100px] pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-neon-purple/10 rounded-full blur-[80px] pointer-events-none" />
        
        <div className="relative">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center">
              <Trophy className="w-6 h-6 text-void" />
            </div>
            <div>
              <h1 className="text-3xl font-bold font-display gradient-text">Maçlar</h1>
              <p className="text-sm text-slate-400">Tüm futbol karşılaşmaları ve canlı skorlar</p>
            </div>
          </div>
          
          <MatchStats matches={matches} />
        </div>
      </div>
      
      <div>
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <Calendar className="w-5 h-5 text-neon-cyan" />
            Karşılaşmalar
          </h2>
          <span className="text-sm text-slate-500">{matches.length} maç gösteriliyor</span>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} />
          ))}
        </div>
      </div>
    </div>
  );
}
