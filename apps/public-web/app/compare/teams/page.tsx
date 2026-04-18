import { z } from "zod";
import { envelopeSchema, publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../../src/lib/fetch-with-schema";
import { TeamSelector, TeamCard, ComparisonBar, ProbabilityDisplay, H2HMatches } from "../../../src/components/compare";
import { GitCompare, Sparkles, TrendingUp, Activity, Trophy, Dumbbell } from "lucide-react";

interface CompareTeamsPageProps {
  searchParams: Promise<{
    homeTeamId?: string;
    awayTeamId?: string;
    seasonId?: string;
    sport?: string;
  }>;
}

type SportScope = "football" | "basketball";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const footballAxisMeta: Record<string, { label: string; description: string }> = {
  offense: { label: "Hücum Gücü", description: "Takımın pozisyon üretme ve gol tehdidi seviyesi." },
  defense: { label: "Savunma Dayanıklılığı", description: "Rakibin ataklarını kırma ve gol yememe istikrarı." },
  tempo: { label: "Oyun Temposu", description: "Maç ritmini belirleme ve oyunu istediği hızda oynama gücü." },
  setPiece: { label: "Duran Top Etkisi", description: "Korner ve serbest vuruşları değerlendirme kalitesi." },
  transition: { label: "Geçiş Oyunu", description: "Top kazanımı sonrası hızlı hücum verimliliği." },
  cohesion: { label: "Takım Uyumu", description: "Oyuncuların birlikte oynama alışkanlığı." },
  overall: { label: "Genel Denge", description: "Tüm başlıkların birleşiminden oluşan toplam performans." }
};

const basketballAxisMeta: Record<string, { label: string; description: string }> = {
  shotQualityCreation: { label: "Şut Kalitesi Üretimi", description: "Verimli şut seçimi ve boş şut bulma becerisi." },
  halfCourtOffense: { label: "Set Hücumu", description: "Yarım sahada set yerleşiminden sayı bulma kalitesi." },
  transitionOffense: { label: "Geçiş Hücumu", description: "Hızlı hücumlarda sayıya dönüşüm verimliliği." },
  rimPressure: { label: "Pota Baskısı", description: "Boyalı alan tehdidi ve çizgiye gitme potansiyeli." },
  perimeterShotProfile: { label: "Dış Şut Profili", description: "Dış şut seçimi ve isabet dengesi." },
  turnoverControl: { label: "Top Kaybı Kontrolü", description: "Topu koruma ve rakibe kolay pozisyon vermeme." },
  offensiveRebounding: { label: "Hücum Ribaundu", description: "Kaçan şutları ikinci şansa çevirme." },
  defensiveRebounding: { label: "Savunma Ribaundu", description: "Rakibin ikinci şanslarını kesme." },
  rimDefense: { label: "Pota Savunması", description: "Boyalı alanda bitiriş yüzdesini düşürme." },
  perimeterDefense: { label: "Dış Savunma", description: "Perimetre baskısı ve şut contest kalitesi." },
  foulDiscipline: { label: "Faul Disiplini", description: "Gereksiz faullerden kaçınarak ritim koruma." },
  benchImpact: { label: "Bench Etkisi", description: "Yedek birimin tempo ve skor katkısı." },
  starPowerReliability: { label: "Yıldız Sürekliliği", description: "Ana skor opsiyonlarının devamlı katkısı." },
  paceControl: { label: "Tempo Kontrolü", description: "Maçın hızını kendi lehine yönetme." },
  clutchStability: { label: "Kritik An Dayanıklılığı", description: "Son bölümlerde karar kalitesi ve hata seviyesi." },
  scheduleFreshness: { label: "Takvim Tazeliği", description: "Dinlenme günü, seyahat ve yorgunluk etkisi." },
  overall: { label: "Genel Denge", description: "Tüm metriklerin toplam güç etkisi." }
};

const teamMatchesSchema = envelopeSchema(
  z.array(
    z
      .object({
        id: z.string().uuid(),
        status: z.string(),
        matchDateTimeUTC: z.string(),
        homeScore: z.number().nullable(),
        awayScore: z.number().nullable(),
        league: z.object({ name: z.string() }).optional(),
        homeTeam: z.object({ id: z.string().uuid(), name: z.string() }),
        awayTeam: z.object({ id: z.string().uuid(), name: z.string() })
      })
      .passthrough()
  )
);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function resolveSport(raw?: string): SportScope {
  const normalized = String(raw ?? "").trim().toLowerCase();
  if (normalized === "basketball" || normalized === "basket" || normalized === "nba") {
    return "basketball";
  }
  return "football";
}

function deriveMatchOutcomeProbabilities(compareData: z.infer<typeof publicContract.compareTeamsResponseSchema>["data"]) {
  const overall = compareData.axes.find((axis) => axis.key === "overall") ?? compareData.axes[0];
  const confidence = clamp(compareData.confidenceScore ?? 0.5, 0, 1);
  const delta = overall ? overall.homeValue - overall.awayValue : 0;
  const edge = Math.tanh(delta * 2.1) * 0.32;
  const drawProbability = clamp(0.34 - Math.abs(delta) * 0.14 + (1 - confidence) * 0.1, 0.02, 0.46);
  const remaining = 1 - drawProbability;
  const homeShare = clamp(0.5 + edge, 0.12, 0.88);
  const home = remaining * homeShare;
  const away = remaining - home;

  return {
    home: clamp(home, 0.05, 0.9),
    draw: clamp(drawProbability, 0.02, 0.9),
    away: clamp(away, 0.05, 0.9)
  };
}

export default async function CompareTeamsPage({ searchParams }: CompareTeamsPageProps) {
  const query = await searchParams;
  const sport = resolveSport(query.sport);

  let teamOptions: z.infer<typeof publicContract.teamsResponseSchema>["data"] = [];
  try {
    const teamsResponse = await fetchWithSchema(`/api/v1/teams?sport=${sport}&take=2500`, publicContract.teamsResponseSchema);
    teamOptions = teamsResponse.data;
  } catch {
    teamOptions = [];
  }

  const requestedHome = query.homeTeamId && teamOptions.some((team) => team.id === query.homeTeamId) ? query.homeTeamId : undefined;
  const requestedAway = query.awayTeamId && teamOptions.some((team) => team.id === query.awayTeamId) ? query.awayTeamId : undefined;

  const defaultHome = requestedHome ?? teamOptions[0]?.id;
  const defaultAway =
    requestedAway ?? teamOptions.find((team) => team.id !== defaultHome)?.id ?? teamOptions[1]?.id;

  const selectedHomeTeam = teamOptions.find((team) => team.id === defaultHome);
  const selectedAwayTeam = teamOptions.find((team) => team.id === defaultAway);

  const hasValidSelection =
    !!defaultHome &&
    !!defaultAway &&
    defaultHome !== defaultAway &&
    uuidPattern.test(defaultHome) &&
    uuidPattern.test(defaultAway);

  let compareResponse: z.infer<typeof publicContract.compareTeamsResponseSchema> | null = null;
  if (hasValidSelection) {
    try {
      compareResponse = await fetchWithSchema(
        `/api/v1/compare/teams?homeTeamId=${defaultHome}&awayTeamId=${defaultAway}&sport=${sport}`,
        publicContract.compareTeamsResponseSchema
      );
    } catch {
      compareResponse = null;
    }
  }

  let h2hMatches: z.infer<typeof teamMatchesSchema>["data"] = [];
  if (hasValidSelection && defaultHome && defaultAway) {
    try {
      const [homeMatchesResponse, awayMatchesResponse] = await Promise.all([
        fetchWithSchema(`/api/v1/teams/${defaultHome}/matches?sport=${sport}`, teamMatchesSchema),
        fetchWithSchema(`/api/v1/teams/${defaultAway}/matches?sport=${sport}`, teamMatchesSchema)
      ]);

      const map = new Map<string, z.infer<typeof teamMatchesSchema>["data"][number]>();
      for (const item of [...homeMatchesResponse.data, ...awayMatchesResponse.data]) {
        const samePair =
          (item.homeTeam.id === defaultHome && item.awayTeam.id === defaultAway) ||
          (item.homeTeam.id === defaultAway && item.awayTeam.id === defaultHome);
        if (samePair) {
          map.set(item.id, item);
        }
      }

      h2hMatches = Array.from(map.values())
        .sort((a, b) => new Date(b.matchDateTimeUTC).getTime() - new Date(a.matchDateTimeUTC).getTime())
        .slice(0, 10);
    } catch {
      h2hMatches = [];
    }
  }

  const probabilities = compareResponse ? deriveMatchOutcomeProbabilities(compareResponse.data) : null;
  const axisMeta = sport === "basketball" ? basketballAxisMeta : footballAxisMeta;
  const pageTitle = sport === "basketball" ? "Basketbol Takım Karşılaştırma" : "Futbol Takım Karşılaştırma";
  const pageSubtitle =
    sport === "basketball"
      ? "Basketbol metrikleri ile iki takımı aynı eksende analiz edin."
      : "Futbol metrikleri ile iki takımın güç dengesini karşılaştırın.";

  return (
    <div className="space-y-8">
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-surface via-abyss to-void p-4 sm:p-6 lg:p-8">
        <div className="pointer-events-none absolute right-0 top-0 h-96 w-96 rounded-full bg-neon-cyan/10 blur-[100px]" />
        <div className="pointer-events-none absolute bottom-0 left-0 h-64 w-64 rounded-full bg-neon-purple/10 blur-[80px]" />

        <div className="relative">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-neon-cyan to-neon-purple">
              <GitCompare className="h-6 w-6 text-void" />
            </div>
            <div>
              <h1 className="gradient-text font-display text-3xl font-bold">{pageTitle}</h1>
              <p className="text-sm text-slate-400">{pageSubtitle}</p>
            </div>
          </div>

          <div className="mb-5 inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
            <a
              href="/futbol/karsilastir"
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                sport === "football" ? "bg-neon-cyan/20 text-neon-cyan" : "text-slate-300 hover:bg-white/10"
              }`}
            >
              <Trophy className="h-4 w-4" /> Futbol
            </a>
            <a
              href="/basketbol/karsilastir"
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                sport === "basketball" ? "bg-neon-purple/20 text-neon-purple" : "text-slate-300 hover:bg-white/10"
              }`}
            >
              <Dumbbell className="h-4 w-4" /> Basketbol
            </a>
          </div>

          {teamOptions.length === 0 ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
              {sport === "basketball"
                ? "Basketbol takım listesi alınamadı. Lütfen tekrar deneyin."
                : "Futbol takım listesi alınamadı. Lütfen tekrar deneyin."}
            </div>
          ) : (
            <form method="get" className="space-y-4">
              <input type="hidden" name="sport" value={sport} />
              <div className="grid gap-4 md:grid-cols-2">
                <TeamSelector
                  label="Ev Sahibi Takım"
                  name="homeTeamId"
                  teams={teamOptions}
                  defaultValue={defaultHome}
                  excludedTeamId={defaultAway}
                  color="cyan"
                />
                <TeamSelector
                  label="Deplasman Takımı"
                  name="awayTeamId"
                  teams={teamOptions}
                  defaultValue={defaultAway}
                  excludedTeamId={defaultHome}
                  color="purple"
                />
              </div>

              <button
                type="submit"
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-neon-cyan to-neon-purple px-6 py-3 font-semibold text-void transition-opacity hover:opacity-90 md:w-auto"
              >
                <Sparkles className="h-4 w-4" />
                Karşılaştır
              </button>
            </form>
          )}
        </div>
      </div>

      {hasValidSelection && compareResponse && probabilities ? (
        <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <section className="glass-card rounded-2xl p-6">
              <div className="mb-6 flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-neon-cyan" />
                <h2 className="text-lg font-semibold text-white">Karşılaşma Olasılıkları</h2>
              </div>
              <ProbabilityDisplay
                probabilities={probabilities}
                homeTeam={selectedHomeTeam?.name || "Ev Sahibi"}
                awayTeam={selectedAwayTeam?.name || "Deplasman"}
              />
              <div className="mt-6 rounded-xl bg-white/5 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-neon-amber" />
                  <span className="text-sm font-medium text-slate-200">AI Analizi</span>
                </div>
                <p className="text-sm text-slate-400">
                  Model güven seviyesi: <span className="font-semibold text-white">%{Math.round(compareResponse.data.confidenceScore * 100)}</span>
                </p>
                <p className="mt-2 text-sm text-slate-300">{compareResponse.data.summary}</p>
              </div>
            </section>

            <section className="glass-card rounded-2xl p-6">
              <div className="mb-6 flex items-center gap-2">
                <Activity className="h-5 w-5 text-neon-purple" />
                <h2 className="text-lg font-semibold text-white">Detaylı Karşılaştırma</h2>
              </div>
              <div className="space-y-5">
                {compareResponse.data.axes.map((axis) => {
                  const meta = axisMeta[axis.key] ?? { label: axis.key, description: "" };
                  return (
                    <ComparisonBar
                      key={axis.key}
                      label={meta.label}
                      homeValue={axis.homeValue}
                      awayValue={axis.awayValue}
                      description={meta.description}
                    />
                  );
                })}
              </div>
            </section>
          </div>

          <div className="space-y-6">
            <section className="glass-card rounded-2xl p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Takımlar</h2>
              <div className="space-y-4">
                <TeamCard team={selectedHomeTeam} color="cyan" isHome />
                <div className="text-center">
                  <span className="text-2xl font-bold text-slate-600">VS</span>
                </div>
                <TeamCard team={selectedAwayTeam} color="purple" isHome={false} />
              </div>
            </section>

            <section className="glass-card rounded-2xl p-6">
              <h2 className="mb-4 text-lg font-semibold text-white">Geçmiş Karşılaşmalar</h2>
              <H2HMatches matches={h2hMatches} homeTeamId={defaultHome || ""} />
            </section>
          </div>
        </div>
      ) : (
        <div className="glass-card rounded-2xl p-12 text-center">
          <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-neon-cyan/20 to-neon-purple/20">
            <GitCompare className="h-10 w-10 text-slate-400" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-white">Takımları Seçin</h2>
          <p className="text-slate-400">Karşılaştırma yapmak için iki farklı takım seçin.</p>
        </div>
      )}
    </div>
  );
}
