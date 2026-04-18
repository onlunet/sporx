import Link from "next/link";
import { BookOpen, BrainCircuit, ShieldAlert, Target, Trophy, Activity } from "lucide-react";

const quickStart = [
  {
    title: "1) Maç Seç",
    description: "Maçlar ekranından bugün ve yakın tarihteki fikstürü aç."
  },
  {
    title: "2) Tahmin Tipini Seç",
    description: "MS, İY, KG Var/Yok, Alt/Üst ve skor dağılımı sekmelerini karşılaştır."
  },
  {
    title: "3) Güven ve Riski Oku",
    description: "Güven skoru ile risk bayraklarını birlikte değerlendir."
  },
  {
    title: "4) Sonucu Analiz Et",
    description: "Sonuçlanan tahminler ekranından model başarısını takip et."
  }
];

const predictionTypes = [
  {
    title: "Maç Sonucu (MS)",
    text: "Ev - Beraberlik - Deplasman olasılıklarını gösterir. En yüksek oran tek başına yeterli değildir."
  },
  {
    title: "İlk Yarı / İY-MS",
    text: "İlk yarı ritmini ve maç sonu sonucunu birlikte değerlendirir. Erken gol oynaklığını dikkate al."
  },
  {
    title: "KG Var / Yok",
    text: "İki takımın da gol bulma ihtimalini verir. Form ve savunma profili ile birlikte okunmalıdır."
  },
  {
    title: "Alt / Üst",
    text: "1.5 / 2.5 / 3.5 çizgilerinde toplam gol tahminini verir. Çizgi değiştikçe olasılık da değişir."
  },
  {
    title: "Doğru Skor",
    text: "Tek bir skor yerine skor dağılımı ile okunmalıdır. Üst sıradaki 3 skor genelde daha anlamlıdır."
  },
  {
    title: "Gol Aralığı",
    text: "Düşük, orta, yüksek gol senaryosunu özetler. Maç temposunu hızlı okumak için uygundur."
  }
];

const riskNotes = [
  "Güven skoru yüksek olsa bile risk bayrağı varsa tahmin temkinli ele alınmalıdır.",
  "Kadro belirsizliği, hakem belirsizliği ve hava etkisi güven skorunu düşürebilir.",
  "Tek bir markete bakmak yerine aynı maçın birden fazla tahmin tipini birlikte kontrol et."
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
            Kullanıcı Rehberi
          </div>
          <h1 className="font-display text-3xl font-bold text-white md:text-4xl">SporX Platformu Nasıl Okunur?</h1>
          <p className="mt-3 max-w-3xl text-slate-300">
            Bu sayfa tahmin ekranlarını doğru yorumlaman için hazırlandı. Amaç, olasılık, güven skoru ve risk
            bayraklarını birlikte okuyup daha tutarlı analiz yapabilmek.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link
              href="/futbol/tahminler"
              className="rounded-lg border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition hover:bg-neon-cyan/20"
            >
              Tahminlere Git
            </Link>
            <Link
              href="/futbol/sonuclar"
              className="rounded-lg border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:bg-white/10"
            >
              Sonuçlanan Tahminler
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
            <h2 className="text-lg font-semibold text-white">Güven ve Risk Nasıl Yorumlanır?</h2>
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
              <span>Güven 70+ : daha tutarlı sinyal</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
              <Activity className="h-4 w-4 text-neon-amber" />
              <span>Güven 56-69 : dengeli/temkinli</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 p-2">
              <ShieldAlert className="h-4 w-4 text-neon-red" />
              <span>Güven 55 altı : yüksek belirsizlik</span>
            </div>
          </div>
        </article>
      </section>

      <section className="rounded-2xl border border-white/10 bg-surface/50 p-6">
        <div className="mb-4 flex items-center gap-2">
          <Trophy className="h-5 w-5 text-neon-green" />
          <h2 className="text-xl font-semibold text-white">Sık Sorulanlar</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white">Neden bazen tahmin çıkmıyor?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Veri kalitesi yetersizse veya maç yeni açıldıysa model tahmini beklemeye alabilir.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white">Neden yüksek güvenli tahmin de yanılabiliyor?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Spor doğası gereği sürpriz sonucu tamamen sıfırlamak mümkün değildir. Güven skoru kesinlik değildir.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white">Canlı ve oynanmamış maç farkı nedir?</h3>
            <p className="mt-2 text-sm text-slate-300">
              Oynanmamış maçlar pre-match analizdir, canlı ekran ise anlık skor ve değişen olasılıkları izler.
            </p>
          </article>
          <article className="rounded-xl border border-white/10 bg-white/5 p-4">
            <h3 className="text-sm font-semibold text-white">Model başarısını nereden izlerim?</h3>
            <p className="mt-2 text-sm text-slate-300">
              <Link href="/futbol/sonuclar" className="text-neon-cyan hover:underline">
                Sonuçlanan Tahminler
              </Link>{" "}
              ekranında toplam doğru/yanlış ve tahmin tipi bazlı başarıyı görebilirsin.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
