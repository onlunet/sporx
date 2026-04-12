import { TrendingUp, Target, Eye, Star } from 'lucide-react';

export function UserStats() {
  return (
    <div className='grid grid-cols-2 gap-4'>
      <div className='glass-card rounded-xl p-4'>
        <div className='flex items-center gap-2 mb-2'>
          <Eye className='w-4 h-4 text-neon-cyan' />          
          <span className='text-xs text-slate-400'>İnceleme</span>
        </div>        
        <div className='text-2xl font-bold text-white'>128</div>        
        <div className='text-xs text-slate-500'>Maç görüntülendi</div>
      </div>
      
      <div className='glass-card rounded-xl p-4'>
        <div className='flex items-center gap-2 mb-2'>
          <Target className='w-4 h-4 text-neon-purple' />          
          <span className='text-xs text-slate-400'>Tahmin</span>
        </div>        
        <div className='text-2xl font-bold text-white'>45</div>        
        <div className='text-xs text-slate-500'>Analiz yapıldı</div>
      </div>
      
      <div className='glass-card rounded-xl p-4'>
        <div className='flex items-center gap-2 mb-2'>
          <Star className='w-4 h-4 text-neon-amber' />          
          <span className='text-xs text-slate-400'>Favori</span>
        </div>        
        <div className='text-2xl font-bold text-white'>12</div>        
        <div className='text-xs text-slate-500'>Takım eklendi</div>
      </div>
      
      <div className='glass-card rounded-xl p-4'>
        <div className='flex items-center gap-2 mb-2'>
          <TrendingUp className='w-4 h-4 text-neon-green' />          
          <span className='text-xs text-slate-400'>Başarı</span>
        </div>        
        <div className='text-2xl font-bold text-white'>%68</div>        
        <div className='text-xs text-slate-500'>Tahmin doğruluğu</div>
      </div>
    </div>
  );
}
