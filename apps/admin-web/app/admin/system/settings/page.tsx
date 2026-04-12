import { SectionCard } from "@sporx/ui";
import { AdminEndpointPage } from "../../_components/admin-endpoint-page";
import { adminApiGet } from "../../_lib/admin-api";

type SystemSettingItem = {
  key: string;
  value: unknown;
  description?: string | null;
};

type TunableSetting = {
  key: string;
  label: string;
  description: string;
  step?: string;
  min?: string;
  max?: string;
  fallback: number;
};

const RISK_TUNING_FIELDS: TunableSetting[] = [
  {
    key: "prediction.lowConfidenceThreshold",
    label: "Düşük Güven Eşiği",
    description: "Bu eşik altındaki tahminler düşük güven olarak işaretlenir.",
    step: "0.01",
    min: "0.35",
    max: "0.80",
    fallback: 0.54
  },
  {
    key: "prediction.infoFlagSuppressionThreshold",
    label: "Bilgilendirici Bayrak Gizleme Eşiği",
    description: "Bu güven seviyesinin üzerindeki tahminlerde düşük önem bayrakları gizlenir.",
    step: "0.01",
    min: "0.50",
    max: "0.90",
    fallback: 0.7
  },
  {
    key: "risk.lowScoreBias.threshold",
    label: "Low Score Bias Eşiği",
    description: "Düşük skor sapması riskinin tetiklenmesi için lowScoreBias eşiği.",
    step: "0.01",
    min: "0.05",
    max: "0.35",
    fallback: 0.18
  },
  {
    key: "risk.lowScoreBias.totalGoalsThreshold",
    label: "Toplam Gol Alt Eşiği",
    description: "Beklenen toplam gol bu eşik altındaysa low score bias tetiklenir.",
    step: "0.01",
    min: "1.00",
    max: "2.40",
    fallback: 1.6
  },
  {
    key: "risk.conflict.baseEloGapThreshold",
    label: "Conflict Taban Elo Farkı",
    description: "CONFLICTING_SIGNALS için başlangıç Elo fark eşiği.",
    step: "1",
    min: "20",
    max: "100",
    fallback: 45
  },
  {
    key: "risk.conflict.leagueGoalEnvMultiplier",
    label: "Conflict Lig Ortam Katsayısı",
    description: "Lig gol ortamının conflict Elo eşiğine etkisi.",
    step: "1",
    min: "5",
    max: "45",
    fallback: 20
  },
  {
    key: "risk.conflict.volatilityMultiplier",
    label: "Conflict Volatilite Katsayısı",
    description: "Volatilitenin conflict Elo eşiğine etkisi.",
    step: "1",
    min: "5",
    max: "50",
    fallback: 25
  },
  {
    key: "risk.conflict.outcomeEdgeBase",
    label: "Conflict Olasılık Marjı (Taban)",
    description: "CONFLICTING_SIGNALS için taban home-away olasılık marj eşiği.",
    step: "0.01",
    min: "0.05",
    max: "0.30",
    fallback: 0.11
  },
  {
    key: "risk.conflict.outcomeEdgeVolatilityMultiplier",
    label: "Conflict Marj Volatilite Katsayısı",
    description: "Volatiliteye göre olasılık marj eşik artış katsayısı.",
    step: "0.01",
    min: "0.02",
    max: "0.35",
    fallback: 0.12
  },
  {
    key: "risk.conflict.minCalibratedConfidence",
    label: "Conflict Min Kalibre Güven",
    description: "CONFLICTING_SIGNALS için minimum kalibre edilmiş güven skoru.",
    step: "0.01",
    min: "0.40",
    max: "0.85",
    fallback: 0.56
  }
];

interface PageProps {
  searchParams: Promise<{ updated?: string; error?: string; preset?: string }>;
}

const errorText: Record<string, string> = {
  settings_empty: "Kaydedilecek geçerli bir ayar bulunamadı.",
  settings_update_failed: "Sistem ayarları güncellenemedi.",
  invalid_credentials: "Oturum doğrulanamadı. Lütfen tekrar giriş yapın.",
  preset_unknown: "Seçilen hazır profil tanınmadı."
};

const presetLabel: Record<string, string> = {
  aggressive: "Agresif",
  balanced: "Dengeli",
  conservative: "Temkinli"
};

const PRESET_META: Record<
  "aggressive" | "balanced" | "conservative",
  {
    title: string;
    description: string;
    recommended: string;
    buttonClass: string;
  }
> = {
  aggressive: {
    title: "Agresif",
    description: "Daha az uyarı, daha fazla sinyal. Yanlış pozitif riski artar.",
    recommended: "Ar-Ge ve hızlı tuning için",
    buttonClass:
      "rounded-md border border-fuchsia-700/70 bg-fuchsia-950/30 px-3 py-1.5 text-sm text-fuchsia-200 hover:bg-fuchsia-900/40"
  },
  balanced: {
    title: "Dengeli",
    description: "Risk ve kapsama arasında dengeli varsayılan profil.",
    recommended: "Canlı kullanım için önerilen",
    buttonClass:
      "rounded-md border border-cyan-700/70 bg-cyan-950/30 px-3 py-1.5 text-sm text-cyan-200 hover:bg-cyan-900/40"
  },
  conservative: {
    title: "Temkinli",
    description: "Daha çok uyarı üretir, riskli sinyalleri daha erken keser.",
    recommended: "Kritik dönem / düşük tolerans",
    buttonClass:
      "rounded-md border border-emerald-700/70 bg-emerald-950/30 px-3 py-1.5 text-sm text-emerald-200 hover:bg-emerald-900/40"
  }
};

function resolveSettingNumericValue(value: unknown, fallback: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value.trim().replace(",", "."));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const candidate = (value as { value?: unknown }).value;
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string") {
      const parsed = Number(candidate.trim().replace(",", "."));
      return Number.isFinite(parsed) ? parsed : fallback;
    }
  }
  return fallback;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const settingsResult = await adminApiGet<SystemSettingItem[]>("/api/v1/admin/system/settings");
  const settingMap = new Map<string, unknown>();
  if (settingsResult.ok && Array.isArray(settingsResult.data)) {
    for (const item of settingsResult.data) {
      settingMap.set(item.key, item.value);
    }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Risk ve Güven Eşikleri" subtitle="Tahmin motoru için conflict/low-score risk eşiklerini buradan düzenleyin.">
        {params.updated === "1" ? (
          <p className="rounded-md border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">Ayarlar güncellendi.</p>
        ) : null}

        {params.updated === "1" && params.preset ? (
          <p className="mt-2 rounded-md border border-cyan-800 bg-cyan-950/40 p-3 text-sm text-cyan-200">
            Uygulanan hazır profil: {presetLabel[params.preset] ?? params.preset}
          </p>
        ) : null}

        {params.error ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{errorText[params.error] ?? "İşlem başarısız."}</p>
        ) : null}

        {!settingsResult.ok ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{settingsResult.error}</p>
        ) : (
          <div className="space-y-4">
            <div className="rounded-md border border-slate-700 bg-slate-950/40 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Hazır Profil Uygula</p>
              <div className="mt-3 grid gap-2 lg:grid-cols-3">
                {(Object.keys(PRESET_META) as Array<keyof typeof PRESET_META>).map((presetKey) => (
                  <div key={presetKey} className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-100">{PRESET_META[presetKey].title}</p>
                      <span className="rounded border border-slate-600 bg-slate-800 px-2 py-0.5 text-[10px] text-slate-300">
                        {PRESET_META[presetKey].recommended}
                      </span>
                    </div>
                    <p className="mb-3 text-xs text-slate-400">{PRESET_META[presetKey].description}</p>
                    <form action="/api/admin/system/settings?next=/admin/system/settings" method="post">
                      <input type="hidden" name="preset" value={presetKey} />
                      <button type="submit" className={PRESET_META[presetKey].buttonClass}>
                        {PRESET_META[presetKey].title} Profili Uygula
                      </button>
                    </form>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-slate-400">Hazır profil, aşağıdaki tüm eşikleri tek seferde günceller.</p>
            </div>

            <form action="/api/admin/system/settings?next=/admin/system/settings" method="post" className="grid gap-3 md:grid-cols-2">
              {RISK_TUNING_FIELDS.map((field) => {
                const value = resolveSettingNumericValue(settingMap.get(field.key), field.fallback);
                return (
                  <label key={field.key} className="block space-y-1">
                    <span className="text-xs text-slate-300">{field.label}</span>
                    <input
                      name={field.key}
                      type="number"
                      step={field.step ?? "0.01"}
                      min={field.min}
                      max={field.max}
                      defaultValue={value}
                      className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                    />
                    <span className="block text-[11px] text-slate-400">{field.description}</span>
                  </label>
                );
              })}

              <div className="md:col-span-2 flex items-center justify-between">
                <p className="text-xs text-slate-400">Kaydet sonrası yeni tahmin üretimlerinde eşikler otomatik uygulanır.</p>
                <button
                  type="submit"
                  className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700"
                >
                  Eşikleri Kaydet
                </button>
              </div>
            </form>
          </div>
        )}
      </SectionCard>

      <AdminEndpointPage
        title="Sistem Ayarları"
        subtitle="Anahtar bazlı sistem ayarları"
        endpoint="/api/v1/admin/system/settings"
        emptyText="Sistem ayarı bulunamadı."
        insight="Bu parametreler tüm sistemi etkiler. Ayar değişikliklerinde önce staging doğrulaması, sonra kontrollü canlı geçiş uygulayın."
        columns={[
          { key: "key", label: "Ayar Anahtarı" },
          { key: "value", label: "Ayar Değeri" },
          { key: "description", label: "Açıklama" },
          { key: "updatedAt", label: "Güncelleme" }
        ]}
      />
    </div>
  );
}
