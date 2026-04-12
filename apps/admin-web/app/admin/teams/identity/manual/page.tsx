import { MetricChip, SectionCard } from "@sporx/ui";
import { adminApiGet } from "../../../_lib/admin-api";
import { TeamIdentityActionForms } from "./TeamIdentityActionForms";

type TeamOption = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
};

type TeamIdentitySummary = {
  totalTeams: number;
  canonicalTeams: number;
  mergedTeams: number;
  manualMergeGroups: number;
  manualBlockPairs: number;
  issueGroups: number;
};

type TeamIdentityIssue = {
  normalizedName: string;
  canonicalTeamId: string;
  canonicalTeamName: string;
  riskLevel: "low" | "medium" | "high";
  variants: Array<{
    id: string;
    name: string;
    country: string | null;
    isCanonical: boolean;
  }>;
};

type TeamIdentityIssuesResponse = {
  summary: TeamIdentitySummary;
  issues: TeamIdentityIssue[];
};

interface TeamIdentityManualPageProps {
  searchParams: Promise<{ updated?: string; error?: string }>;
}

const errorText: Record<string, string> = {
  action_missing: "Aksiyon tipi eksik.",
  action_failed: "Kural güncelleme işlemi başarısız oldu.",
  invalid_credentials: "Oturum doğrulanamadı. Lütfen tekrar giriş yapın."
};

function shortId(value: string) {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

export default async function TeamIdentityManualPage({ searchParams }: TeamIdentityManualPageProps) {
  const params = await searchParams;

  const [teamsResult, issuesResult] = await Promise.all([
    adminApiGet<TeamOption[]>("/api/v1/teams?take=10000"),
    adminApiGet<TeamIdentityIssuesResponse>("/api/v1/admin/teams/identity/issues?limit=60")
  ]);

  const teams = teamsResult.ok && teamsResult.data ? teamsResult.data : [];
  const summary = issuesResult.ok && issuesResult.data ? issuesResult.data.summary : null;
  const topIssues = issuesResult.ok && issuesResult.data ? issuesResult.data.issues.slice(0, 20) : [];

  return (
    <div className="space-y-4">
      <SectionCard
        title="Takım Kimlik Manuel İşlemler"
        subtitle="Otomatik eşleşmeyen takımları elle birleştirin veya yanlış eşleşmeleri engelleyin."
      >
        {params.updated === "1" ? (
          <p className="rounded-md border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">
            İşlem uygulandı. Kimlik eşleştirme haritası yenilendi.
          </p>
        ) : null}

        {params.error ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">
            {errorText[params.error] ?? "İşlem başarısız."}
          </p>
        ) : null}

        <p className="mt-3 text-xs text-slate-400">
          Bu ekran gelecekte ortaya çıkabilecek yeni duplicate durumları için hızlı manuel müdahale alanıdır.
          İşlem sonrası değişiklikler otomatik olarak tüm kanonik takım listesine yansır.
        </p>
      </SectionCard>

      {summary ? (
        <SectionCard title="Kimlik Özeti" subtitle="Anlık eşleştirme durumu">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
            <MetricChip label="Toplam Takım" value={summary.totalTeams} />
            <MetricChip label="Kanonik Takım" value={summary.canonicalTeams} />
            <MetricChip label="Birleşen Kayıt" value={summary.mergedTeams} />
            <MetricChip label="Şüpheli Grup" value={summary.issueGroups} />
            <MetricChip label="Manuel Merge" value={summary.manualMergeGroups} />
            <MetricChip label="Engellenen Çift" value={summary.manualBlockPairs} />
          </div>
        </SectionCard>
      ) : null}

      {!teamsResult.ok ? (
        <SectionCard title="Takım Listesi" subtitle="API erişim hatası">
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{teamsResult.error}</p>
        </SectionCard>
      ) : null}

      {teams.length > 0 ? (
        <SectionCard
          title="Manuel Aksiyonlar"
          subtitle="Takımları yazarak arayın, önerilerden seçin ve seçilen kartlardan kontrol ederek işlemi gönderin."
        >
          <TeamIdentityActionForms teams={teams} />
        </SectionCard>
      ) : null}

      {topIssues.length > 0 ? (
        <SectionCard title="Hızlı Referans" subtitle="Şüpheli gruplardan ilk 20 kayıt">
          <div className="space-y-3">
            {topIssues.map((issue) => (
              <article
                key={`${issue.normalizedName}-${issue.canonicalTeamId}`}
                className="rounded-md border border-slate-700 bg-slate-950/40 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{issue.canonicalTeamName}</p>
                    <p className="text-xs text-slate-400">Normalize: {issue.normalizedName}</p>
                  </div>
                  <span className="rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] text-slate-300">
                    Risk: {issue.riskLevel}
                  </span>
                </div>

                <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-300">
                  {issue.variants.map((variant) => (
                    <span key={variant.id} className="rounded border border-slate-700 bg-slate-900/70 px-2 py-0.5">
                      {variant.name} {variant.country ? `(${variant.country})` : ""}{" "}
                      {variant.isCanonical ? "[kanonik]" : ""} - {shortId(variant.id)}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
