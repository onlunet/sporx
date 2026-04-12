import { Server, Database, Cpu, Wifi } from 'lucide-react';

const services = [
  { name: 'API Sunucu', status: 'operational', icon: Server },
  { name: 'Veritabanı', status: 'operational', icon: Database },
  { name: 'AI Model', status: 'operational', icon: Cpu },
  { name: 'Veri Akışı', status: 'operational', icon: Wifi },
];

export function SystemStatus() {
  return (
    <div className='space-y-3'>
      {services.map((service) => (
        <div key={service.name} className='flex items-center justify-between p-3 rounded-xl bg-white/5'>
          <div className='flex items-center gap-3'>
            <div className='w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center'>
              <service.icon className='w-4 h-4 text-slate-400' />
            </div>            
            <span className='text-sm text-slate-300'>{service.name}</span>
          </div>          
          <div className='flex items-center gap-1.5'>
            <span className='w-2 h-2 rounded-full bg-neon-green' />            
            <span className='text-xs text-slate-400'>Aktif</span>
          </div>
        </div>
      ))}
    </div>
  );
}
