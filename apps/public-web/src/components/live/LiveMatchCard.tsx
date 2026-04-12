'use client';

import Link from 'next/link';
import { Shield, Activity, Clock, TrendingUp, Zap } from 'lucide-react';

interface LiveMatchCardProps {
  match: {
    id: string;
    homeTeam: string;
    awayTeam: string;
    leagueName: string;
    score: { home: number | null; away: number | null };
    kickoffAt: string;
    predictions: {
      probabilities?: { home?: number; draw?: number; away?: number };
    }[];
  };
}

export function LiveMatchCard({ match }: LiveMatchCardProps) {
  const scoreHome = match.score.home ?? 0;
  const scoreAway = match.score.away ?? 0;
  
  const hasPrediction = match.predictions.length > 0;
  const probs = hasPrediction ? match.predictions[0].probabilities : null;
  
  return (
    <Link href={`/matches/${match.id}`}>
      <article className='group relative overflow-hidden rounded-2xl bg-gradient-to-br from-surface/80 to-abyss/90 border border-neon-red/20 hover:border-neon-red/50 transition-all duration-500'>
        <div className='absolute inset-0 bg-gradient-to-br from-neon-red/5 via-transparent to-neon-cyan/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500' />        
        <div className='absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-neon-red via-neon-amber to-neon-cyan animate-pulse' />
        
        <div className='relative p-5'>
          <div className='flex items-center justify-between mb-4'>
            <span className='text-xs text-slate-400'>{match.leagueName}</span>            
            <div className='flex items-center gap-1.5'>
              <span className='w-2 h-2 rounded-full bg-neon-red animate-pulse' />
              <span className='text-xs font-bold text-neon-red'>CANLI</span>
            </div>
          </div>
          
          <div className='flex items-center justify-between gap-4'>
            <div className='flex-1 text-center'>
              <div className='w-12 h-12 mx-auto mb-2 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center'>
                <Shield className='w-6 h-6 text-slate-400' />
              </div>              
              <span className='text-sm font-medium text-slate-200'>{match.homeTeam}</span>
            </div>
            
            <div className='flex-shrink-0 text-center'>
              <div className='text-4xl font-bold font-display tracking-wider'>
                <span className='text-white'>{scoreHome}</span>
                <span className='text-slate-600 mx-2'>:</span>
                <span className='text-white'>{scoreAway}</span>
              </div>              
              <div className='mt-1 flex items-center justify-center gap-1 text-[10px] text-neon-red'>
                <Activity className='w-3 h-3' />
                CANLI
              </div>
            </div>
            
            <div className='flex-1 text-center'>
              <div className='w-12 h-12 mx-auto mb-2 rounded-xl bg-gradient-to-br from-slate-700 to-slate-800 flex items-center justify-center'>
                <Shield className='w-6 h-6 text-slate-400' />
              </div>              
              <span className='text-sm font-medium text-slate-200'>{match.awayTeam}</span>
            </div>
          </div>
          
          {probs && (
            <div className='mt-4 pt-4 border-t border-white/5'>
              <div className='flex items-center justify-between text-xs'>
                <div className='text-center'>
                  <div className='text-neon-cyan font-bold'>%{Math.round((probs.home ?? 0) * 100)}</div>
                  <div className='text-slate-500'>Ev</div>
                </div>                
                <div className='text-center'>
                  <div className='text-neon-amber font-bold'>%{Math.round((probs.draw ?? 0) * 100)}</div>
                  <div className='text-slate-500'>Ber.</div>
                </div>                
                <div className='text-center'>
                  <div className='text-neon-purple font-bold'>%{Math.round((probs.away ?? 0) * 100)}</div>
                  <div className='text-slate-500'>Dep.</div>
                </div>
              </div>
            </div>
          )}
        </div>
      </article>
    </Link>
  );
}
