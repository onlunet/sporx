"use client";

import { useQuery } from "@tanstack/react-query";
import { Calendar, Dumbbell, RefreshCw, Swords } from "lucide-react";
import { MatchCard } from "./MatchCard";
import { MatchStats } from "./MatchStats";
import { resolveBrowserApiBase } from "../../lib/api-base-url";

type SportScope = "football" | "basketball";

type MatchSummary = {
  id: string;
  kickoffAt: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  score?: { home: number | null; away: number | null } | null;
};

type Envelope<T> = {
  success: boolean;
  data: T;
  meta: unknown;
  error: unknown;
};

type MatchesExplorerProps = {
  sport: SportScope;
  initialMatches?: MatchSummary[];
  initialLoadError?: boolean;
};

async function fetchMatches(sport: SportScope): Promise<MatchSummary[]> {
  const apiBase = resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL);
  const response = await fetch(`${apiBase}/api/v1/matches?sport=${sport}&take=120`, {
    cache: "no-store",
    credentials: "include"
  });

  if (!response.ok) {
    throw new Error(`matches_${sport}_${response.status}`);
  }

  const json = (await response.json()) as Envelope<MatchSummary[]>;
  return Array.isArray(json?.data) ? json.data.slice(0, 24) : [];
}

function loadErrorMessage(sport: SportScope) {
  return sport === "basketball"
    ? "Basketbol maç listesi şu an sınırlı gelebilir. Veri akışı toparlandığında otomatik güncellenecek."
    : "Futbol maç listesi şu an sınırlı gelebilir. Veri akışı toparlandığında otomatik güncellenecek.";
}

export function MatchesExplorer({ sport, initialMatches = [], initialLoadError = false }: MatchesExplorerProps) {
  const query = useQuery({
    queryKey: ["public-matches", sport],
    queryFn: () => fetchMatches(sport),
    initialData: initialMatches,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const matches = query.data ?? initialMatches;
  const icon =
    sport === "basketball" ? <Dumbbell className="h-6 w-6 text-void" /> : <Swords className="h-5 w-5 sm:h-6 sm:w-6 text-void" />;
  const title = sport === "basketball" ? "Basketbol Maçları" : "Futbol Maçları";
  const description =
    sport === "basketball"
      ? "Basketbol karşılaşmaları, skorlar ve maç detayları"
      : "Futbol karşılaşmaları, skorlar ve maç detayları";
  const hrefPrefix = sport === "basketball" ? "/basketbol/maclar" : "/futbol/maclar";
  const hasRecovered = matches.length > 0;
  const shouldShowWarning = (initialLoadError || query.isError) && !hasRecovered;

  return (
    <div className="space-y-6 sm:space-y-8">
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl border border-white/10 bg-gradient-to-br from-surface via-abyss to-void p-5 sm:p-6 lg:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-64 w-64 sm:h-96 sm:w-96 rounded-full bg-neon-cyan/10 blur-[80px] sm:blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-48 w-48 sm:h-64 sm:w-64 rounded-full bg-neon-purple/10 blur-[60px] sm:blur-[80px]" />

        <div className="relative">
          <div className="mb-3 sm:mb-4 flex items-center gap-3">
            <div className="flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple">
              {icon}
            </div>
            <div>
              <h1 className="gradient-text font-display text-2xl sm:text-3xl font-bold">{title}</h1>
              <p className="text-xs sm:text-sm text-slate-400">{description}</p>
            </div>
          </div>

          {shouldShowWarning ? (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
              {loadErrorMessage(sport)}
            </div>
          ) : null}

          <MatchStats matches={matches} />
        </div>
      </div>

      <div>
        <div className="mb-4 sm:mb-6 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base sm:text-lg font-semibold text-white">
            <Calendar className="h-5 w-5 text-neon-cyan" />
            Karşılaşmalar
          </h2>
          <div className="flex items-center gap-3 text-xs sm:text-sm text-slate-500">
            <span>{matches.length} maç gösteriliyor</span>
            {query.isFetching ? <RefreshCw className="h-4 w-4 animate-spin text-neon-cyan" /> : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:gap-5 md:grid-cols-2 xl:grid-cols-3">
          {matches.map((match) => (
            <MatchCard key={match.id} match={match} href={`${hrefPrefix}/${match.id}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
