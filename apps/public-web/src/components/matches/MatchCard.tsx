import Link from 'next/link';
import { Trophy, Calendar, Clock, TrendingUp, ChevronRight, Shield, Activity } from 'lucide-react';
import { StatusBadge } from './StatusBadge';

interface MatchCardProps {
  match: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    leagueName: string;
    status: string;
    kickoffAt: string;
    score?: { home: number | null; away: number | null } | null;
  };
}

export function MatchCard({ match }: MatchCardProps) {
  const matchDate = new Date(match.kickoffAt);
  const isLive = match.status.toLowerCase() === 'live';
  const hasScore = match.score?.home !== null && match.score?.away !== null;
  
  return (
    <Link href={`/matches/${match.id}`}>
      <article className='group relative overflow-hidden rounded-2xl bg-gradient-to-br from-surface/80 to-abyss/90 border border-white/5 hover:border-neon-cyan/30 transition-all duration-500 hover:shadow-glow-cyan/20 hover:shadow-lg'>
        <div className='absolute inset-0 bg-gradient-to-br from-neon-cyan/5 via-transparent to-neon-purple/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500' />
        
        <div className='relative flex items-center justify-between px-5 py-3 border-b border-white/5'>
          <div className='flex items-center gap-2 text-xs text-slate-400'>
            <Trophy className='w-3.5 h-3.5 text-neon-amber' />
            <span className='font-medium'>{match.leagueName}</span>
          </div>
          <StatusBadge status={match.status} />
        </div>
        
        <div className='relative p-5'>
          <div className='flex items-center justify-between gap-4'>
            <div className='flex-1 text-center'>
              <div className='w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center group-hover:from-neon-cyan/20 group-hover:to-neon-purple/20 transition-all duration-500'>
                <Shield className='w-7 h-7 text-slate-400 group-hover:text-neon-cyan transition-colors' />
              </div>
              <h3 className='text-sm font-semibold text-slate-200 group-hover:text-white transition-colors line-clamp-2'>
                {match.homeTeam}
              </h3>
            </div>
            
            <div className='flex-shrink-0'>
              {hasScore ? (
                <div className='text-center'>
                  <div className='text-3xl font-bold font-display tracking-wider'>
                    <span className='text-white'>{match.score!.home}</span>
                    <span className='text-slate-500 mx-2'>:</span>
                    <span className='text-white'>{match.score!.away}</span>
                  </div>
                  {isLive && (
                    <div className='mt-1 flex items-center justify-center gap-1 text-[10px] text-neon-red font-medium'>
                      <Activity className='w-3 h-3' />
                      CANLI
                    </div>
                  )}
                </div>
              ) : (
                <div className='text-center px-4'>
                  <div className='text-2xl font-bold text-slate-500 font-display'>VS</div>
                  <div className='mt-1 text-[10px] text-slate-500 uppercase tracking-widest'>Maç Başlamadı</div>
                </div>
              )}
            </div>
            
            <div className='flex-1 text-center'>
              <div className='w-14 h-14 mx-auto mb-3 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center group-hover:from-neon-purple/20 group-hover:to-neon-cyan/20 transition-all duration-500'>
                <Shield className='w-7 h-7 text-slate-400 group-hover:text-neon-purple transition-colors' />
              </div>
              <h3 className='text-sm font-semibold text-slate-200 group-hover:text-white transition-colors line-clamp-2'>
                {match.awayTeam}
              </h3>
            </div>
          </div>
          
          <div className='mt-5 flex items-center justify-center gap-4 text-xs text-slate-500'>
            <div className='flex items-center gap-1.5'>
              <Calendar className='w-3.5 h-3.5' />
              <span>{matchDate.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })}</span>
            </div>
            <div className='flex items-center gap-1.5'>
              <Clock className='w-3.5 h-3.5' />
              <span>{matchDate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </div>
        </div>
        
        <div className='relative flex items-center justify-between px-5 py-3 bg-white/[0.02] border-t border-white/5'>
          <div className='flex items-center gap-2 text-xs text-slate-500'>
            <TrendingUp className='w-3.5 h-3.5' />
            <span>Analiz ve Tahminler</span>
          </div>
          <ChevronRight className='w-4 h-4 text-slate-600 group-hover:text-neon-cyan group-hover:translate-x-1 transition-all' />
        </div>
        
        <div className='absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none'>
          <div className='absolute inset-0 rounded-2xl bg-gradient-to-r from-neon-cyan/10 via-transparent to-neon-purple/10' />
        </div>
      </article>
    </Link>
  );
}
