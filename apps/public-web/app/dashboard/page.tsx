import { publicContract } from '@sporx/api-contract';
import { fetchWithSchema } from '../../src/lib/fetch-with-schema';
import { MetricCard, ConfidenceChart, RecentActivity, SystemStatus } from '../../src/components/dashboard';
import { 
  LayoutDashboard, 
  Trophy, 
  BrainCircuit, 
  AlertTriangle,
  TrendingUp,
  Activity,
  Server,
  Clock
} from 'lucide-react';

export default async function DashboardPage() {
  const response = await fetchWithSchema('/api/v1/analytics/dashboard', publicContract.dashboardResponseSchema);
  
  let predictionOverview: {
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
  } | null = null;

  try {
    const predictions = await fetchWithSchema('/api/v1/predictions', publicContract.predictionsResponseSchema);
    const highConfidence = predictions.data.filter((item) => item.confidenceScore >= 0.7).length;
    const mediumConfidence = predictions.data.filter((item) => item.confidenceScore >= 0.56 && item.confidenceScore < 0.7).length;
    const lowConfidence = predictions.data.filter((item) => item.confidenceScore < 0.56).length;
    predictionOverview = { highConfidence, mediumConfidence, lowConfidence };
  } catch {
    predictionOverview = null;
  }

  return (
    <div className='space-y-8'>
      <div className='relative overflow-hidden rounded-3xl bg-gradient-to-br from-surface via-abyss to-void border border-white/10 p-8'>
        <div className='absolute top-0 right-0 w-96 h-96 bg-neon-cyan/10 rounded-full blur-[100px] pointer-events-none' />
        <div className='absolute bottom-0 left-0 w-64 h-64 bg-neon-purple/10 rounded-full blur-[80px] pointer-events-none' />
        
        <div className='relative'>
          <div className='flex items-center gap-3 mb-6'>
            <div className='w-12 h-12 rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple flex items-center justify-center'>
              <LayoutDashboard className='w-6 h-6 text-void' />
            </div>            
            <div>
              <h1 className='text-3xl font-bold font-display gradient-text'>Panel</h1>              
              <p className='text-sm text-slate-400'>Sistem genel bakış ve analitikler</p>
            </div>
          </div>          
          
          <div className='grid grid-cols-2 md:grid-cols-4 gap-4'>
            <MetricCard
              label='Toplam Maç'
              value={response.data.matchCount}
              icon={<Trophy className='w-5 h-5' />}
              color='cyan'
              trend='up'
              trendValue='%12'
            />            
            <MetricCard
              label='Tahmin Sayısı'
              value={response.data.predictionCount}
              icon={<BrainCircuit className='w-5 h-5' />}
              color='purple'
              trend='up'
              trendValue='%8'
            />            
            <MetricCard
              label='Düşük Güven'
              value={response.data.lowConfidenceCount}
              icon={<AlertTriangle className='w-5 h-5' />}
              color='amber'
              trend='down'
              trendValue='%5'
            />            
            <MetricCard
              label='Başarısız Analiz'
              value={response.data.failedCount}
              icon={<TrendingUp className='w-5 h-5' />}
              color='red'
              trend='neutral'
              trendValue='0%'
            />
          </div>          
          
          <div className='mt-4 flex items-center gap-2 text-xs text-slate-500'>
            <Clock className='w-3.5 h-3.5' />            
            <span>Son güncelleme: {new Date(response.data.generatedAt).toLocaleString('tr-TR')}</span>
          </div>
        </div>
      </div>

      <div className='grid lg:grid-cols-3 gap-6'>
        <div className='lg:col-span-2 space-y-6'>
          <section className='glass-card rounded-2xl p-6'>
            <div className='flex items-center gap-2 mb-6'>
              <BrainCircuit className='w-5 h-5 text-neon-cyan' />              
              <h2 className='text-lg font-semibold text-white'>Tahmin Güven Dağılımı</h2>
            </div>            
            {predictionOverview ? (
              <ConfidenceChart
                high={predictionOverview.highConfidence}
                medium={predictionOverview.mediumConfidence}
                low={predictionOverview.lowConfidence}
              />
            ) : (
              <p className='text-slate-400 text-center py-8'>Güven dağılımı verisi alınamadı.</p>
            )}
          </section>

          <section className='glass-card rounded-2xl p-6'>
            <div className='flex items-center gap-2 mb-6'>
              <Activity className='w-5 h-5 text-neon-purple' />              
              <h2 className='text-lg font-semibold text-white'>Son Aktiviteler</h2>
            </div>            
            <RecentActivity />
          </section>
        </div>

        <div>
          <section className='glass-card rounded-2xl p-6'>
            <div className='flex items-center gap-2 mb-6'>
              <Server className='w-5 h-5 text-neon-green' />              
              <h2 className='text-lg font-semibold text-white'>Sistem Durumu</h2>
            </div>            
            <SystemStatus />
          </section>
        </div>
      </div>
    </div>
  );
}
