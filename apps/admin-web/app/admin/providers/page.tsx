import Link from "next/link";
import { SectionCard } from "@sporx/ui";
import { adminApiGet } from "../_lib/admin-api";

type ProviderView = {
  key: string;
  name: string;
  isActive: boolean;
  baseUrl: string | null;
  plan: "free" | "paid" | "local";
  supportsSports: string[];
  requiresApiKey: boolean;
  defaultEnabled: boolean;
  description: string;
  website: string;
  configs: Record<string, string>;
};

interface ProvidersPageProps {
  searchParams: Promise<{ updated?: string; syncQueued?: string; error?: string }>;
}

const errorText: Record<string, string> = {
  provider_key_missing: "Sağlayıcı anahtarı eksik.",
  provider_update_failed: "Sağlayıcı durumu güncellenemedi.",
  provider_config_failed: "Sağlayıcı ayarları kaydedilemedi.",
  sync_enqueue_failed: "Senkronizasyon işi kuyruğa eklenemedi.",
  invalid_credentials: "Oturum doğrulanamadı. Lütfen tekrar giriş yapın."
};

function planLabel(plan: ProviderView["plan"]) {
  if (plan === "free") {
    return "Ücretsiz";
  }
  if (plan === "paid") {
    return "Ücretli";
  }
  return "Yerel";
}

function planBadgeClass(plan: ProviderView["plan"]) {
  if (plan === "free") {
    return "border-emerald-500/50 bg-emerald-950/40 text-emerald-300";
  }
  if (plan === "paid") {
    return "border-amber-500/50 bg-amber-950/40 text-amber-300";
  }
  return "border-slate-600 bg-slate-800 text-slate-300";
}

function boolLabel(value: boolean) {
  return value ? "Açık" : "Kapalı";
}

export default async function ProvidersPage({ searchParams }: ProvidersPageProps) {
  const params = await searchParams;
  const result = await adminApiGet<ProviderView[]>("/api/v1/admin/providers");

  return (
    <div className="space-y-4">
      <SectionCard title="API Sağlayıcı Ayarları" subtitle="Ücretsiz sağlayıcılar varsayılan olarak aktif gelir. Ayarları buradan yönetebilirsiniz.">
        {params.updated === "1" ? (
          <p className="rounded-md border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">Ayarlar güncellendi.</p>
        ) : null}

        {params.syncQueued === "1" ? (
          <p className="rounded-md border border-blue-900 bg-blue-950/40 p-3 text-sm text-blue-200">Veri çekme işi kuyruğa alındı.</p>
        ) : null}

        {params.error ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{errorText[params.error] ?? "İşlem başarısız."}</p>
        ) : null}

        <form action="/api/admin/providers/sync?next=/admin/providers" method="post" className="mt-3">
          <button
            type="submit"
            className="rounded-md border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-800/40"
          >
            Aktif Sağlayıcılardan Veriyi Çek
          </button>
        </form>

        <p className="mt-3 text-xs text-slate-400">
          Çekim loglarını <Link className="text-emerald-300 hover:text-emerald-200" href="/admin/logs/api">API Kayıtları</Link> menüsünden görebilirsiniz.
        </p>
      </SectionCard>

      {!result.ok ? (
        <SectionCard title="Sağlayıcılar" subtitle="API erişim hatası">
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{result.error}</p>
        </SectionCard>
      ) : null}

      {result.ok && Array.isArray(result.data)
        ? result.data.map((provider) => (
            <SectionCard key={provider.key} title={`${provider.name} (${provider.key})`} subtitle={provider.description}>
              <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
                <span className={`rounded-md border px-2 py-1 ${planBadgeClass(provider.plan)}`}>{planLabel(provider.plan)}</span>
                <span className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-slate-300">
                  Spor: {provider.supportsSports.join(", ") || "-"}
                </span>
                <span className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-slate-300">API Key: {boolLabel(provider.requiresApiKey)}</span>
                <span className="rounded-md border border-slate-600 bg-slate-800 px-2 py-1 text-slate-300">Durum: {provider.isActive ? "Aktif" : "Pasif"}</span>
              </div>

              <div className="mb-4 flex flex-wrap items-center gap-3">
                <form action="/api/admin/providers/toggle?next=/admin/providers" method="post">
                  <input type="hidden" name="key" value={provider.key} />
                  <input type="hidden" name="isActive" value={provider.isActive ? "0" : "1"} />
                  <button
                    type="submit"
                    className={`rounded-md border px-3 py-1.5 text-sm ${
                      provider.isActive
                        ? "border-red-700 bg-red-950/40 text-red-200 hover:bg-red-900/40"
                        : "border-emerald-700 bg-emerald-900/30 text-emerald-200 hover:bg-emerald-800/40"
                    }`}
                  >
                    {provider.isActive ? "Devre Dışı Bırak" : "Etkinleştir"}
                  </button>
                </form>

                {provider.website !== "local" ? (
                  <a className="text-sm text-emerald-300 hover:text-emerald-200" href={provider.website} target="_blank" rel="noreferrer">
                    Dokümantasyon
                  </a>
                ) : null}
              </div>

              <form action="/api/admin/providers/config?next=/admin/providers" method="post" className="grid gap-3 md:grid-cols-2">
                <input type="hidden" name="key" value={provider.key} />

                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Base URL</span>
                  <input
                    name="baseUrl"
                    defaultValue={provider.baseUrl ?? ""}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">API Key</span>
                  <input
                    name="apiKey"
                    type="password"
                    defaultValue={provider.configs.apiKey ?? ""}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Competition Code (Football)</span>
                  <input
                    name="competitionCode"
                    defaultValue={provider.configs.competitionCode ?? ""}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Soccer League ID</span>
                  <input
                    name="soccerLeagueId"
                    defaultValue={provider.configs.soccerLeagueId ?? ""}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs text-slate-300">Basketball League ID</span>
                  <input
                    name="basketballLeagueId"
                    defaultValue={provider.configs.basketballLeagueId ?? ""}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                  />
                </label>

                <div className="flex items-end">
                  <button
                    type="submit"
                    className="rounded-md border border-slate-600 bg-slate-800 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-700"
                  >
                    Ayarları Kaydet
                  </button>
                </div>
              </form>
            </SectionCard>
          ))
        : null}
    </div>
  );
}
