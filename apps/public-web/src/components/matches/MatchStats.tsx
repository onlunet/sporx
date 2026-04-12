import { Activity, Clock, Trophy } from 'lucide-react';

interface MatchStatsProps {
  matches: any[];
}

export function MatchStats({ matches }: MatchStatsProps) {
  const liveCount = matches.filter(m => m.status.toLowerCase() === 'live').length;
  const upcomingCount = matches.filter(m => 
    m.status.toLowerCase() === 'scheduled' || m.status.toLowerCase() === 'upcoming'
  ).length;
  const finishedCount = matches.filter(m => m.status.toLowerCase() === 'finished').length;
  
  return (
    <div className='grid grid-cols-3 gap-4'>
      <div className='glass-card rounded-xl p-4 text-center'>
        <div className='w-10 h-10 mx-auto mb-2 rounded-lg bg-neon-red/20 flex items-center justify-center'>
          <Activity className='w-5 h-5 text-neon-red' />
        </div>
        <div className='text-2xl font-bold text-white'>{liveCount}</div>
        <div className='text-xs text-slate-400'>Canlı Maç</div>
      </div>
      <div className='glass-card rounded-xl p-4 text-center'>
        <div className='w-10 h-10 mx-auto mb-2 rounded-lg bg-neon-cyan/20 flex items-center justify-center'>
          <Clock className='w-5 h-5 text-neon-cyan' />
        </div>
        <div className='text-2xl font-bold text-white'>{upcomingCount}</div>
        <div className='text-xs text-slate-400'>Yakında</div>
      </div>
      <div className='glass-card rounded-xl p-4 text-center'>
        <div className='w-10 h-10 mx-auto mb-2 rounded-lg bg-slate-700/50 flex items-center justify-center'>
          <Trophy className='w-5 h-5 text-slate-400' />
        </div>
        <div className='text-2xl font-bold text-white'>{finishedCount}</div>
        <div className='text-xs text-slate-400'>Tamamlandı</div>
      </div>
    </div>
  );
}
