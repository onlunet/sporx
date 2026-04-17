import { Bell, Moon, Globe, Shield, ChevronRight } from 'lucide-react';

interface SettingItemProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  action?: React.ReactNode;
}

function SettingItem({ icon, label, description, action }: SettingItemProps) {
  return (
    <div className='flex flex-col sm:flex-row sm:items-center justify-between py-4 border-b border-white/5 last:border-0 gap-3'>
      <div className='flex items-center gap-3'>
        <div className='w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center'>
          {icon}
        </div>        
        <div>
          <div className='text-sm font-medium text-white'>{label}</div>          
          <div className='text-xs text-slate-500'>{description}</div>
        </div>
      </div>      
      <div className='flex items-center'>
        {action || <ChevronRight className='w-5 h-5 text-slate-600' />}
      </div>
    </div>
  );
}

function Toggle() {
  return (
    <button className='relative w-11 h-6 rounded-full bg-slate-700 transition-colors focus:outline-none'>
      <span className='absolute left-1 top-1 w-4 h-4 rounded-full bg-white transition-transform' />
    </button>
  );
}

export function SettingsSection() {
  return (
    <div className='glass-card rounded-2xl p-6'>
      <h3 className='text-lg font-semibold text-white mb-4'>Ayarlar</h3>      
      
      <div className='space-y-1'>
        <SettingItem
          icon={<Bell className='w-5 h-5 text-neon-cyan' />}
          label='Bildirimler'
          description='Maç ve tahmin bildirimleri'
          action={<Toggle />}
        />        
        <SettingItem
          icon={<Moon className='w-5 h-5 text-neon-purple' />}
          label='Karanlık Mod'
          description='Otomatik tema değişimi'
          action={<Toggle />}
        />        
        <SettingItem
          icon={<Globe className='w-5 h-5 text-neon-amber' />}
          label='Dil'
          description='Türkçe'
        />        
        <SettingItem
          icon={<Shield className='w-5 h-5 text-neon-green' />}
          label='Gizlilik'
          description='Veri paylaşım tercihleri'
        />
      </div>
    </div>
  );
}
