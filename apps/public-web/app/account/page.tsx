import { ProfileCard, UserStats, SettingsSection, SubscriptionCard } from '../../src/components/account';
import { User, Settings } from 'lucide-react';

export default function AccountPage() {
  return (
    <div className='space-y-8'>
      <div className='relative overflow-hidden rounded-3xl bg-gradient-to-br from-surface via-abyss to-void border border-white/10 p-4 sm:p-6 lg:p-8'>
        <div className='absolute top-0 right-0 w-96 h-96 bg-neon-cyan/10 rounded-full blur-[100px] pointer-events-none' />
        <div className='absolute bottom-0 left-0 w-64 h-64 bg-neon-purple/10 rounded-full blur-[80px] pointer-events-none' />
        
        <div className='relative'>
          <div className='flex items-center gap-3'>
            <div className='w-12 h-12 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center'>
              <User className='w-6 h-6 text-void' />
            </div>            
            <div>
              <h1 className='text-3xl font-bold font-display gradient-text'>Hesap</h1>              
              <p className='text-sm text-slate-400'>Profil ve tercih ayarları</p>
            </div>
          </div>
        </div>
      </div>

      <div className='grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6'>
        <div className='lg:col-span-2 space-y-6'>
          <ProfileCard />          
          <UserStats />          
          <SettingsSection />
        </div>        
        
        <div>
          <SubscriptionCard />
        </div>
      </div>
    </div>
  );
}
