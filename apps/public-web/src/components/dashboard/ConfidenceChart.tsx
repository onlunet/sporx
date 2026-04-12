interface ConfidenceChartProps {
  high: number;
  medium: number;
  low: number;
}

export function ConfidenceChart({ high, medium, low }: ConfidenceChartProps) {
  const total = high + medium + low;
  const highPercent = total > 0 ? (high / total) * 100 : 0;
  const mediumPercent = total > 0 ? (medium / total) * 100 : 0;
  const lowPercent = total > 0 ? (low / total) * 100 : 0;
  
  return (
    <div className='space-y-4'>
      <div className='flex h-4 rounded-full overflow-hidden'>
        <div 
          className='bg-neon-green transition-all duration-1000' 
          style={{ width: `${highPercent}%` }}
        />        
        <div 
          className='bg-neon-amber transition-all duration-1000' 
          style={{ width: `${mediumPercent}%` }}
        />        
        <div 
          className='bg-neon-red transition-all duration-1000' 
          style={{ width: `${lowPercent}%` }}
        />
      </div>      
      
      <div className='grid grid-cols-3 gap-4'>
        <div className='text-center'>
          <div className='text-lg font-bold text-neon-green'>{high}</div>          
          <div className='text-xs text-slate-400'>Yüksek Güven</div>          
          <div className='text-[10px] text-slate-600'>%{Math.round(highPercent)}</div>
        </div>        
        <div className='text-center'>
          <div className='text-lg font-bold text-neon-amber'>{medium}</div>          
          <div className='text-xs text-slate-400'>Orta Güven</div>          
          <div className='text-[10px] text-slate-600'>%{Math.round(mediumPercent)}</div>
        </div>        
        <div className='text-center'>
          <div className='text-lg font-bold text-neon-red'>{low}</div>          
          <div className='text-xs text-slate-400'>Düşük Güven</div>          
          <div className='text-[10px] text-slate-600'>%{Math.round(lowPercent)}</div>
        </div>
      </div>
    </div>
  );
}
