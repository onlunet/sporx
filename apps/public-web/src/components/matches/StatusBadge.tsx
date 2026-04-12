import { Activity } from 'lucide-react';

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const statusConfig: Record<string, { label: string; className: string }> = {
    live: { 
      label: 'CANLI', 
      className: 'bg-neon-red/20 text-neon-red border-neon-red/40 animate-pulse' 
    },
    finished: { 
      label: 'BİTTİ', 
      className: 'bg-slate-700/50 text-slate-400 border-slate-600' 
    },
    upcoming: { 
      label: 'YAKINDA', 
      className: 'bg-neon-cyan/20 text-neon-cyan border-neon-cyan/40' 
    },
    scheduled: { 
      label: 'PLANLANDI', 
      className: 'bg-neon-purple/20 text-neon-purple border-neon-purple/40' 
    },
  };
  
  const config = statusConfig[status.toLowerCase()] || statusConfig.scheduled;
  
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wider border ${config.className}`}>
      {status.toLowerCase() === 'live' && (
        <span className='w-1.5 h-1.5 rounded-full bg-current animate-pulse' />
      )}
      {config.label}
    </span>
  );
}
