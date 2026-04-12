import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string | number;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  icon: React.ReactNode;
  color: 'cyan' | 'purple' | 'amber' | 'green' | 'red';
}

export function MetricCard({ label, value, trend, trendValue, icon, color }: MetricCardProps) {
  const colorClasses = {
    cyan: 'from-neon-cyan/20 to-neon-cyan/5 border-neon-cyan/30',
    purple: 'from-neon-purple/20 to-neon-purple/5 border-neon-purple/30',
    amber: 'from-neon-amber/20 to-neon-amber/5 border-neon-amber/30',
    green: 'from-neon-green/20 to-neon-green/5 border-neon-green/30',
    red: 'from-neon-red/20 to-neon-red/5 border-neon-red/30',
  };
  
  const iconColors = {
    cyan: 'text-neon-cyan',
    purple: 'text-neon-purple',
    amber: 'text-neon-amber',
    green: 'text-neon-green',
    red: 'text-neon-red',
  };
  
  return (
    <div className={`glass-card rounded-2xl p-5 border bg-gradient-to-br ${colorClasses[color]}`}>
      <div className='flex items-start justify-between'>
        <div className={`w-10 h-10 rounded-xl bg-slate-800/50 flex items-center justify-center ${iconColors[color]}`}>
          {icon}
        </div>        
        {trend && (
          <div className={`flex items-center gap-1 text-xs ${
            trend === 'up' ? 'text-neon-green' : trend === 'down' ? 'text-neon-red' : 'text-slate-500'
          }`}>
            {trend === 'up' && <TrendingUp className='w-3.5 h-3.5' />}
            {trend === 'down' && <TrendingDown className='w-3.5 h-3.5' />}
            {trend === 'neutral' && <Minus className='w-3.5 h-3.5' />}
            {trendValue}
          </div>
        )}
      </div>      
      <div className='mt-4'>
        <div className='text-3xl font-bold text-white'>{value}</div>        
        <div className='text-sm text-slate-400 mt-1'>{label}</div>
      </div>
    </div>
  );
}
