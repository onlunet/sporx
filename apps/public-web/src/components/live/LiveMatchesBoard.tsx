"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  MatchPredictionItem,
  isLiveMatchStatus,
  normalizeMatchStatus,
  normalizePredictionList
} from "../../features/predictions";
import { LiveMatchCard, LiveStats } from "./";
import { Radio, RefreshCw, Zap } from "lucide-react";
import { resolveBrowserApiBase } from "../../lib/api-base-url";

type SportScope = "football" | "basketball";

type Envelope<T> = {
  success: boolean;
  data: T;
  meta: unknown;
  error: unknown;
};

type MatchSummary = {
  id: string;
  kickoffAt: string;
  leagueName: string;
  homeTeam: string;
  awayTeam: string;
  status: string;
  score: { home: number | null; away: number | null };
};

type LiveMatchRow = MatchSummary & { predictions: MatchPredictionItem[] };

async function fetchEnvelope<T>(path: string): Promise<Envelope<T> | null> {
  const apiBase = resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL);
  try {
    const response = await fetch(`${apiBase}${path}`, {
      cache: "no-store",
      credentials: "include"
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Envelope<T>;
  } catch {
    return null;
  }
}

function withSport(path: string, sport?: SportScope): string {
  if (!sport) {
    return path;
  }
  const joiner = path.includes("?") ? "&" : "?";
  return `${path}${joiner}sport=${sport}`;
}

async function fetchLiveMatches(sport?: SportScope): Promise<MatchSummary[]> {
  const response = await fetchEnvelope<MatchSummary[]>(withSport("/api/v1/matches?status=live&take=50", sport));
  const data = Array.isArray(response?.data) ? response.data : [];
  return data.filter((item) => isLiveMatchStatus(item.status));
}

async function fetchLivePredictions(sport?: SportScope): Promise<MatchPredictionItem[]> {
  const response = await fetchEnvelope<unknown>(withSport("/api/v1/predictions?status=live", sport));
  const all = normalizePredictionList(response?.data);
  return all.filter((item) => {
    const normalized = normalizeMatchStatus(item.matchStatus);
    if (isLiveMatchStatus(normalized)) {
      return true;
    }
    const hasLiveScore =
      item.homeScore !== null &&
      item.homeScore !== undefined &&
      item.awayScore !== null &&
      item.awayScore !== undefined;
    return hasLiveScore;
  });
}

function normalizeScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return null;
  }
  return Math.max(0, Math.round(value));
}

type LiveMatchesBoardProps = {
  sport?: SportScope;
};

export function LiveMatchesBoard({ sport }: LiveMatchesBoardProps = {}) {
  const sportLabel = sport === "basketball" ? "Basketbol" : "Futbol";

  const matchesQuery = useQuery({
    queryKey: ["live-matches", sport ?? "all"],
    queryFn: () => fetchLiveMatches(sport),
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1
  });

  const predictionsQuery = useQuery({
    queryKey: ["live-predictions", sport ?? "all"],
    queryFn: () => fetchLivePredictions(sport),
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1
  });

  const rows = useMemo<LiveMatchRow[]>(() => {
    const byMatchId = new Map<string, LiveMatchRow>();

    for (const match of matchesQuery.data ?? []) {
      byMatchId.set(match.id, { ...match, predictions: [] });
    }

    for (const prediction of predictionsQuery.data ?? []) {
      const existing = byMatchId.get(prediction.matchId);
      if (existing) {
        existing.predictions.push(prediction);
        continue;
      }

      byMatchId.set(prediction.matchId, {
        id: prediction.matchId,
        kickoffAt: prediction.matchDateTimeUTC ?? new Date().toISOString(),
        leagueName: `Canli ${sportLabel}`,
        homeTeam: prediction.homeTeam ?? "Ev Sahibi",
        awayTeam: prediction.awayTeam ?? "Deplasman",
        status: "live",
        score: {
          home: normalizeScore(prediction.homeScore),
          away: normalizeScore(prediction.awayScore)
        },
        predictions: [prediction]
      });
    }

    return Array.from(byMatchId.values()).sort(
      (a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime()
    );
  }, [matchesQuery.data, predictionsQuery.data, sportLabel]);

  const isLoading = matchesQuery.isLoading || predictionsQuery.isLoading;
  const isError = matchesQuery.isError || predictionsQuery.isError;

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-surface via-abyss to-void p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-neon-red/10 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-64 w-64 rounded-full bg-neon-cyan/10 blur-[80px]" />

        <div className="relative">
          <div className="mb-6 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="absolute inset-0 animate-pulse rounded-full bg-neon-red/30 blur-xl" />
                <div className="relative flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-neon-red to-neon-amber">
                  <Radio className="h-6 w-6 text-white" />
                </div>
              </div>
              <div>
                <h1 className="font-display text-3xl font-bold">
                  <span className="text-white">Canli</span> <span className="text-neon-red">{sportLabel} Merkezi</span>
                </h1>
                <p className="text-sm text-slate-400">Gercek zamanli skorlar ve tahminler</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-xs text-slate-500">
              <RefreshCw className={`h-4 w-4 ${matchesQuery.isFetching ? "animate-spin" : ""}`} />
              <span>15 saniyede yenilenir</span>
            </div>
          </div>

          <LiveStats
            matches={rows}
            matchLabel={`Canli ${sportLabel} Maci`}
            scoreLabel={sport === "basketball" ? "Toplam Sayi" : "Toplam Gol"}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-5 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className="h-56 animate-pulse rounded-2xl border border-slate-700 bg-slate-900/30"
            />
          ))}
        </div>
      ) : null}

      {isError ? (
        <div className="glass-card rounded-2xl border-neon-red/30 p-8 text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-neon-red/20">
            <Zap className="h-8 w-8 text-neon-red" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-white">Baglanti Hatasi</h2>
          <p className="text-slate-400">Canli veri alinamadi. Otomatik olarak tekrar denenecek.</p>
        </div>
      ) : null}

      {!isLoading && !isError && rows.length === 0 ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-slate-800">
            <Radio className="h-10 w-10 text-slate-600" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-white">Su Anda Canli Mac Yok</h2>
          <p className="text-slate-400">Canli karsilasmalar basladiginda burada gorunecek.</p>
        </div>
      ) : null}

      {!isLoading && !isError ? (
        <div className="grid gap-5 md:grid-cols-2">
          {rows.map((match) => (
            <LiveMatchCard key={match.id} match={match} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
