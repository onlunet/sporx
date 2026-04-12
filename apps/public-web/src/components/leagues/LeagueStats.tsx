import { Globe, Trophy, MapPin } from 'lucide-react';

interface LeagueStatsProps {
  leagues: { country: string | null }[];
}

export function LeagueStats({ leagues }: LeagueStatsProps) {
  const totalLeagues = leagues.length;
  const uniqueCountries = new Set(leagues.map(l => l.country).filter(Boolean)).size;
  const internationalLeagues = leagues.filter(l => !l.country).length;
  
  return (
    <div className='grid grid-cols-3 gap-4'>
      <div className='glass-card rounded-xl p-4 text-center'>
        <div className='w-10 h-10 mx-auto mb-2 rounded-lg bg-neon-cyan/20 flex items-center justify-center'>
          <Trophy className='w-5 h-5 text-neon-cyan' />
        </div>
        <div className='text-2xl font-bold text-white'>{totalLeagues}</div>
        <div className='text-xs text-slate-400'>Toplam Lig</div>
      </div>
      
      <div className='glass-card rounded-xl p-4 text-center'>
        <div className='w-10 h-10 mx-auto mb-2 rounded-lg bg-neon-purple/20 flex items-center justify-center'>
          <MapPin className='w-5 h-5 text-neon-purple' />
        </div>
        <div className='text-2xl font-bold text-white'>{uniqueCountries}</div>
        <div className='text-xs text-slate-400'>Ülke</div>
      </div>
      
      <div className='glass-card rounded-xl p-4 text-center'>
        <div className='w-10 h-10 mx-auto mb-2 rounded-lg bg-neon-amber/20 flex items-center justify-center'>
          <Globe className='w-5 h-5 text-neon-amber' />
        </div>
        <div className='text-2xl font-bold text-white'>{internationalLeagues}</div>
        <div className='text-xs text-slate-400'>Uluslararası</div>
      </div>
    </div>
  );
}
