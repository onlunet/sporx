'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MatchPredictionItem, normalizePredictionList } from '../../features/predictions';
import { LiveMatchCard, LiveStats } from './';
import { Radio, RefreshCw, Zap } from 'lucide-react';
import { resolveBrowserApiBase } from '../../lib/api-base-url';

const API_URL = resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL);

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
  try {
    const response = await fetch(`${API_URL}${path}`, {
      cache: 'no-store',
      credentials: 'include',
    });
    if (!response.ok) return null;
    return (await response.json()) as Envelope<T>;
  } catch {
    return null;
  }
}

async function fetchLiveMatches(): Promise<MatchSummary[]> {
  const response = await fetchEnvelope<MatchSummary[]>('/api/v1/matches?status=live&take=50');
  const data = Array.isArray(response?.data) ? response.data : [];
  return data.filter((item) => item.status?.toLowerCase() === 'live');
}

async function fetchLivePredictions(): Promise<MatchPredictionItem[]> {
  const response = await fetchEnvelope<unknown>('/api/v1/predictions?status=live');
  const all = normalizePredictionList(response?.data);
  return all.filter((item) => (item.matchStatus ?? '').toLowerCase() === 'live');
}

function normalizeScore(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.max(0, Math.round(value));
}

export function LiveMatchesBoard() {
  const matchesQuery = useQuery({
    queryKey: ['live-matches'],
    queryFn: fetchLiveMatches,
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1,
  });

  const predictionsQuery = useQuery({
    queryKey: ['live-predictions'],
    queryFn: fetchLivePredictions,
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: 1,
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
        leagueName: 'Canlı',
        homeTeam: prediction.homeTeam ?? 'Ev sahibi',
        awayTeam: prediction.awayTeam ?? 'Deplasman',
        status: 'live',
        score: {
          home: normalizeScore(prediction.homeScore),
          away: normalizeScore(prediction.awayScore),
        },
        predictions: [prediction],
      });
    }

    return Array.from(byMatchId.values()).sort(
      (a, b) => new Date(b.kickoffAt).getTime() - new Date(a.kickoffAt).getTime()
    );
  }, [matchesQuery.data, predictionsQuery.data]);

  const isLoading = matchesQuery.isLoading || predictionsQuery.isLoading;
  const isError = matchesQuery.isError || predictionsQuery.isError;

  return (
    <div className='space-y-8'>
      <div className='relative overflow-hidden rounded-3xl bg-gradient-to-br from-surface via-abyss to-void border border-white/10 p-8'>
        <div className='absolute top-0 right-0 w-96 h-96 bg-neon-red/10 rounded-full blur-[100px] pointer-events-none' />
        <div className='absolute bottom-0 left-0 w-64 h-64 bg-neon-cyan/10 rounded-full blur-[80px] pointer-events-none' />
        
        <div className='relative'>
          <div className='flex items-center justify-between mb-6'>
            <div className='flex items-center gap-3'>
              <div className='relative'>
                <div className='absolute inset-0 bg-neon-red/30 blur-xl rounded-full animate-pulse' />                
                <div className='relative w-12 h-12 rounded-xl bg-gradient-to-br from-neon-red to-neon-amber flex items-center justify-center'>
                  <Radio className='w-6 h-6 text-white' />
                </div>
              </div>              
              <div>
                <h1 className='text-3xl font-bold font-display'>
                  <span className='text-white'>Canlı</span>{' '}
                  <span className='text-neon-red'>Maç Merkezi</span>
                </h1>                
                <p className='text-sm text-slate-400'>Gerçek zamanlı skorlar ve tahminler</p>
              </div>
            </div>
            
            <div className='flex items-center gap-2 text-xs text-slate-500'>
              <RefreshCw className={`w-4 h-4 ${matchesQuery.isFetching ? 'animate-spin' : ''}`} />              
              <span>15 saniyede yenilenir</span>
            </div>
          </div>          
          
          <LiveStats matches={rows} />
        </div>
      </div>

      {isLoading ? (
        <div className='grid gap-5 md:grid-cols-2'>
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              className='h-56 animate-pulse rounded-2xl border border-slate-700 bg-slate-900/30'
            />
          ))}
        </div>
      ) : null}

      {isError ? (
        <div className='glass-card rounded-2xl p-8 text-center border-neon-red/30'>
          <div className='w-16 h-16 mx-auto mb-4 rounded-full bg-neon-red/20 flex items-center justify-center'>
            <Zap className='w-8 h-8 text-neon-red' />
          </div>          
          <h2 className='text-xl font-semibold text-white mb-2'>Bağlantı Hatası</h2>          
          <p className='text-slate-400'>Canlı veri alınamadı. Otomatik olarak tekrar denenecek.</p>
        </div>
      ) : null}

      {!isLoading && !isError && rows.length === 0 ? (
        <div className='glass-card rounded-2xl p-12 text-center'>
          <div className='w-20 h-20 mx-auto mb-4 rounded-full bg-slate-800 flex items-center justify-center'>
            <Radio className='w-10 h-10 text-slate-600' />
          </div>          
          <h2 className='text-xl font-semibold text-white mb-2'>Şu Anda Canlı Maç Yok</h2>          
          <p className='text-slate-400'>Canlı karşılaşmalar başladığında burada görünecek.</p>
        </div>
      ) : null}

      {!isLoading && !isError ? (
        <div className='grid gap-5 md:grid-cols-2'>
          {rows.map((match) => (
            <LiveMatchCard key={match.id} match={match} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
