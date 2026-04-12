import Link from 'next/link';
import { Globe, ChevronRight, Users, Trophy } from 'lucide-react';
import { getCountryEmoji, getCountryColor } from './countryUtils';

interface League {
  id: string;
  name: string;
  country: string | null;
  code?: string | null;
}

interface LeagueCardProps {
  league: League;
  index: number;
}

export function LeagueCard({ league, index }: LeagueCardProps) {
  const countryEmoji = getCountryEmoji(league.country);
  const gradientClass = getCountryColor(league.country);
  
  return (
    <Link href={`/leagues/${league.id}`}>
      <article 
        className='group relative overflow-hidden rounded-2xl bg-gradient-to-br from-surface/80 to-abyss/90 border border-white/5 hover:border-neon-cyan/30 transition-all duration-500'
        style={{ animationDelay: `${index * 50}ms` }}
      >
        <div className='absolute inset-0 bg-gradient-to-br from-neon-cyan/5 via-transparent to-neon-purple/5 opacity-0 group-hover:opacity-100 transition-opacity duration-500' />
        
        <div className='relative p-5'>
          <div className='flex items-start gap-4'>
            <div className={`w-16 h-16 rounded-2xl bg-gradient-to-br ${gradientClass} flex items-center justify-center text-3xl shadow-lg group-hover:scale-110 transition-transform duration-500`}>
              {countryEmoji}
            </div>
            
            <div className='flex-1 min-w-0'>
              <h3 className='text-lg font-bold text-white group-hover:text-neon-cyan transition-colors line-clamp-1'>
                {league.name}
              </h3>              
              <div className='flex items-center gap-2 mt-1'>
                <Globe className='w-3.5 h-3.5 text-slate-500' />
                <span className='text-sm text-slate-400'>{league.country || 'Uluslararası'}</span>
              </div>
              
              {league.code && (
                <span className='inline-block mt-2 px-2 py-0.5 rounded bg-white/5 text-[10px] text-slate-500 font-mono'>
                  {league.code}
                </span>
              )}
            </div>
            
            <ChevronRight className='w-5 h-5 text-slate-600 group-hover:text-neon-cyan group-hover:translate-x-1 transition-all flex-shrink-0' />
          </div>
          
          <div className='mt-4 pt-4 border-t border-white/5 flex items-center justify-between'>
            <div className='flex items-center gap-4'>
              <div className='flex items-center gap-1.5 text-xs text-slate-500'>
                <Trophy className='w-3.5 h-3.5 text-neon-amber' />
                <span>Lig Maçları</span>
              </div>
              <div className='flex items-center gap-1.5 text-xs text-slate-500'>
                <Users className='w-3.5 h-3.5 text-neon-purple' />
                <span>Takımlar</span>
              </div>
            </div>          
          </div>
        </div>
        
        <div className='absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none'>
          <div className='absolute inset-0 rounded-2xl bg-gradient-to-r from-neon-cyan/5 via-transparent to-neon-purple/5' />
        </div>
      </article>
    </Link>
  );
}
