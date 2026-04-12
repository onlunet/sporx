import { User, Mail, Calendar, Shield } from 'lucide-react';

export function ProfileCard() {
  return (
    <div className='glass-card rounded-2xl p-6'>
      <div className='flex items-center gap-4'>
        <div className='relative'>
          <div className='w-20 h-20 rounded-2xl bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center'>
            <User className='w-10 h-10 text-white' />
          </div>
          <div className='absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-neon-green flex items-center justify-center'>
            <Shield className='w-3.5 h-3.5 text-void' />
          </div>
        </div>
        <div className='flex-1'>
          <h2 className='text-xl font-bold text-white'>Misafir Kullanıcı</h2>
          <p className='text-sm text-slate-400'>SPORX AI Üyesi</p>

          <div className='flex items-center gap-4 mt-3'>
            <div className='flex items-center gap-1.5 text-xs text-slate-500'>
              <Mail className='w-3.5 h-3.5' />
              <span>misafir@sporx.ai</span>
            </div>
            <div className='flex items-center gap-1.5 text-xs text-slate-500'>
              <Calendar className='w-3.5 h-3.5' />
              <span>Nisan 2025&apos;te katıldı</span>
            </div>
          </div>
        </div>

        <div className='hidden sm:block'>
          <span className='px-3 py-1 rounded-full bg-neon-cyan/20 text-neon-cyan text-xs font-medium'>
            Ücretsiz Plan
          </span>
        </div>
      </div>
    </div>
  );
}
