import { Crown, Check, Zap } from 'lucide-react';

export function SubscriptionCard() {
  return (
    <div className='glass-card rounded-2xl p-6 border-neon-cyan/20'>
      <div className='flex items-center gap-3 mb-4'>
        <div className='w-10 h-10 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center'>
          <Crown className='w-5 h-5 text-white' />
        </div>
        <div>
          <h3 className='text-lg font-semibold text-white'>Ücretsiz Plan</h3>
          <p className='text-xs text-slate-400'>Temel özelliklere erişim</p>
        </div>
      </div>

      <ul className='space-y-2 mb-6'>
        {[
          'Günlük 10 maç analizi',
          'Temel istatistikler',
          'Canlı skor takibi',
          'E-posta desteği',
        ].map((feature) => (
          <li key={feature} className='flex items-center gap-2 text-sm text-slate-300'>
            <Check className='w-4 h-4 text-neon-green' />
            {feature}
          </li>
        ))}
      </ul>

      <button className='w-full py-3 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple text-void font-semibold hover:opacity-90 transition-opacity flex items-center justify-center gap-2'>
        <Zap className='w-4 h-4' />
        Pro&apos;ya Yükselt
      </button>
    </div>
  );
}
