import Link from "next/link";
import { BookOpen, BrainCircuit, ShieldAlert, Target, Trophy, Activity } from "lucide-react";

const quickStart = [
  {
    title: "1) Mac sec",
    description: "Maclar ekranindan bugun ve yakin tarihteki fiksturu ac."
  },
  {
    title: "2) Tahmin tipini sec",
    description: "MS, IY, KG Var/Yok, Alt/Ust ve Skor dagilimi sekmelerini karsilastir."
  },
  {
    title: "3) Guven ve riski oku",
    description: "Guven skoru ile risk bayraklarini birlikte degerlendir."
  },
  {
    title: "4) Sonucu analiz et",
    description: "Sonuclanan tahminler ekranindan motor basarisini takip et."
  }
];

const predictionTypes = [
  {
    title: "Mac Sonucu (MS)",
    text: "Ev - Beraberlik - Deplasman olasiliklarini gosterir. En yuksek oran tek basina yeterli degildir."
  },
  {
    title: "Ilk Yari / IY-MS",
    text: "Ilk yari ritmini ve mac sonu sonucunu birlikte degerlendirir. Erken gol oynakligini dikkate al."
  },
  {
    title: "KG Var / Yok",
    text: "Iki takimin da gol bulma ihtimalini verir. Form ve savunma profili ile birlikte okunmalidir."
  },
  {
    title: "Alt / Ust",
    text: "1.5 / 2.5 / 3.5 cizgilerinde toplam gol tahminini verir. Cizgi degistikce olasilik da degisir."
  },
  {
    title: "Dogru Skor",
    text: "Tek bir skor yerine skor dagilimi ile okunmalidir. Ust siradaki 3 skor genelde daha anlamlidir."
  },
  {
    title: "Gol Araligi",
    text: "Dusuk, orta, yuksek gol senaryosunu ozetler. Mac temposunu hizli okumak icin uygundur."
  }
];

const riskNotes = [
  "Guven skoru yuksek olsa bile risk bayragi varsa tahmin temkinli ele alinmalidir.",
  "Kadro belirsizligi, hakem belirsizligi ve hava etkisi guven skorunu dusurebilir.",
  "Tek bir markete bakmak yerine ayni macin birden fazla tahmin tipini birlikte kontrol et."
];

export default function GuidePage() {
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-surface via-abyss to-void p-8">
        <div className="pointer-events-none absolute -right-8 -top-8 h-48 w-48 rounded-full bg-neon-cyan/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 -left-10 h-56 w-56 rounded-full bg-neon-purple/10 blur-3xl" />

        <div className="relative">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-neon-cyan/30 bg-neon-cyan/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-neon-cyan">
            <BookOpen className="h-3.5 w-3.5" />
            Kullanici Rehberi
          </div>
          <h1 className="font-display text-3xl font-bold text-white md:text-4xl">SporX Platformu Nasil Okunur?</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Bu sayfa tahmin ekranlarini dogru yorumlaman icin hazirlandi. Amac, olasilik, guven skoru ve risk
            bayraklarini birlikte okuyup daha tutarli analiz yapabilmek.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/football/predictions"
              className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition hover:bg-neon-cyan/20"
            >
              Tahminlere Git
            </Link>
            <Link
              href="/football/predictions/completed"
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              Sonuclanan Tahminler
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {quickStart.map((step) => (
          <article key={step.title} className="glass-card rounded-2xl p-5">
            <h2 className="text-base font-semibold text-white">{step.title}</h2>
            <p className="mt-2 text-sm text-slate-300">{step.description}</p>
          </article>
        ))}
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-6">
        <div className="mb-4 flex items-center gap-2">
          <BrainCircuit className="h-5 w-5 text-neon-cyan" />
          <h2 className="text-xl font-semibold text-white">Tahmin Tipleri</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {predictionTypes.map((item) => (
            <article key={item.title} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <h3 className="text-sm font-semibold text-white">{item.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-2xl border border-white/10 bg-surface/50 p-5 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-neon-amber" />
            <h2 className="text-lg font-semibold text-white">Guven ve Risk Nasil Yorumlanir?</h2>
          </div>
          <ul className="space-y-3 text-sm text-slate-300">
            {riskNotes.map((note) => (
              <li key={note} className="rounded-lg border border-white/10 bg-white/5 p-3">
                {note}
              </li>
            ))}
          </ul>
        </article>

        <article className="rounded-2xl border border-white/10 bg-surface/50 p-5">
          <h2 className="mb-3 text-lg font-semibold text-white">Hizli Referans</h2>
          <div className="space-y-2 text-sm text-slate-300">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
              <Target className="h-4 w-4 text-neon-cyan" />
              <span>Guven 70+ : daha tutarli sinyal</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
              <Activity className="h-4 w-4 text-neon-amber" />
              <span>Guven 56-69 : dengeli/temkinli</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
              <ShieldAlert className="h-4 w-4 text-neon-red" />
              <span>Guven 55 alti : yuksek belirsizlik</span>
            </div>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-neon-green" />
          <h2 className="text-xl font-semibold text-white">Sik Sorulanlar</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white">Neden bazen tahmin cikmiyor?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Veri kalitesi yetersizse veya mac yeni acildiysa model tahmini beklemeye alabilir.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white">Neden yuksek guvenli tahmin de yanilabiliyor?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Spor dogasi geregi surpriz sonucu tamamen sifirlamak mumkun degildir. Guven skoru kesinlik degildir.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white">Canli ve oynanmamis mac farki nedir?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Oynanmamis maclar pre-match analizdir, canli ekran ise anlik skor ve degisen olasiliklari izler.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white">Motor basarisini nereden izlerim?</h3>
            <p className="mt-2 text-sm text-slate-300">
              <Link href="/football/predictions/completed" className="text-neon-cyan hover:underline">
                Sonuclanan Tahminler
              </Link>{" "}
              ekraninda toplam dogru/yanlis ve tahmin tipi bazli basariyi gorebilirsin.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
