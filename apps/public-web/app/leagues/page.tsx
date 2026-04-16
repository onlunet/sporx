import { publicContract } from '@sporx/api-contract';
import { fetchWithSchema } from '../../src/lib/fetch-with-schema';
import { LeagueCard, LeagueStats } from '../../src/components/leagues';
import { Globe, Search } from 'lucide-react';

export const dynamic = 'force-dynamic';

export default async function LeaguesPage() {
  const response = await fetchWithSchema('/api/v1/leagues', publicContract.leaguesResponseSchema, {
    cache: 'no-store'
  });
  const leagues = response.data;
  
  return (
    <div className='space-y-8'>
      <div className='relative overflow-hidden rounded-3xl bg-gradient-to-br from-surface via-abyss to-void border border-white/10 p-8'>
        <div className='absolute top-0 right-0 w-96 h-96 bg-neon-purple/10 rounded-full blur-[100px] pointer-events-none' />
        <div className='absolute bottom-0 left-0 w-64 h-64 bg-neon-cyan/10 rounded-full blur-[80px] pointer-events-none' />
        
        <div className='relative'>
          <div className='flex items-center gap-3 mb-3'>
            <div className='w-12 h-12 rounded-xl bg-gradient-to-br from-neon-purple to-neon-cyan flex items-center justify-center'>
              <Globe className='w-6 h-6 text-void' />
            </div>
            <div>
              <h1 className='text-3xl font-bold font-display gradient-text'>Ligler</h1>
              <p className='text-sm text-slate-400'>Dünya genelindeki futbol ligleri ve organizasyonlar</p>
            </div>
          </div>
          
          <LeagueStats leagues={leagues} />
        </div>
      </div>
      
      <div>
        <div className='flex items-center justify-between mb-6'>
          <h2 className='text-lg font-semibold text-white flex items-center gap-2'>
            <Search className='w-5 h-5 text-neon-purple' />
            Tüm Ligler
          </h2>
          <span className='text-sm text-slate-500'>{leagues.length} lig bulundu</span>
        </div>
        
        <div className='grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5'>
          {leagues.map((league, index) => (
            <LeagueCard key={league.id} league={league} index={index} />
          ))}
        </div>
      </div>
    </div>
  );
}
