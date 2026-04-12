import { Activity, CheckCircle, AlertCircle, Clock } from 'lucide-react';

const activities = [
  { id: 1, type: 'success', message: 'Galatasaray - Fenerbahçe analizi tamamlandı', time: '2 dk önce' },
  { id: 2, type: 'info', message: 'Premier League verileri güncellendi', time: '15 dk önce' },
  { id: 3, type: 'warning', message: 'Düşük güven tahmini: Barcelona - Real Madrid', time: '1 saat önce' },
  { id: 4, type: 'success', message: '12 yeni maç eklendi', time: '2 saat önce' },
  { id: 5, type: 'info', message: 'AI modeli güncellendi', time: '3 saat önce' },
];

export function RecentActivity() {
  return (
    <div className='space-y-3'>
      {activities.map((activity) => (
        <div key={activity.id} className='flex items-start gap-3 p-3 rounded-xl bg-white/5'>
          <div className='mt-0.5'>
            {activity.type === 'success' && <CheckCircle className='w-4 h-4 text-neon-green' />}
            {activity.type === 'warning' && <AlertCircle className='w-4 h-4 text-neon-amber' />}
            {activity.type === 'info' && <Activity className='w-4 h-4 text-neon-cyan' />}
          </div>          
          <div className='flex-1 min-w-0'>
            <p className='text-sm text-slate-300'>{activity.message}</p>            
            <div className='flex items-center gap-1 mt-1 text-xs text-slate-500'>
              <Clock className='w-3 h-3' />              {activity.time}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
