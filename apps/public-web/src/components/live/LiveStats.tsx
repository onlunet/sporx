import { Activity, Zap, TrendingUp } from 'lucide-react';

interface LiveStatsProps {
  matches: any[];
}

export function LiveStats({ matches }: LiveStatsProps) {
  const totalMatches = matches.length;
  const withPredictions = matches.filter(m => m.predictions.length > 0).length;
  const totalGoals = matches.reduce((acc, m) => {
    return acc + (m.score.home ?? 0) + (m.score.away ?? 0);
  }, 0);
  
  return (
    <div className='grid grid-cols-3 gap-4'>
      <div className='glass-card rounded-xl p-4 text-center border-neon-red/20'>
        <div className='w-10 h-10 mx-auto mb-2 rounded-lg bg-neon-red/20 flex items-center justify-center'>
          <Activity className='w-5 h-5 text-neon-red' />
        </div>        
        <div className='text-2xl font-bold text-white'>{totalMatches}</div>        
        <div className='text-xs text-slate-400'>Canlı Maç</div>
      </div>
      
      <div className='glass-card rounded-xl p-4 text-center'>
        <div className='w-10 h-10 mx-auto mb-2 rounded-lg bg-neon-cyan/20 flex items-center justify-center'>
          <Zap className='w-5 h-5 text-neon-cyan' />
        </div>        
        <div className='text-2xl font-bold text-white'>{withPredictions}</div>        
        <div className='text-xs text-slate-400'>Tahminli</div>
      </div>
      
      <div className='glass-card rounded-xl p-4 text-center'>
        <div className='w-10 h-10 mx-auto mb-2 rounded-lg bg-neon-amber/20 flex items-center justify-center'>
          <TrendingUp className='w-5 h-5 text-neon-amber' />
        </div>        
        <div className='text-2xl font-bold text-white'>{totalGoals}</div>        
        <div className='text-xs text-slate-400'>Toplam Gol</div>
      </div>
    </div>
  );
}
