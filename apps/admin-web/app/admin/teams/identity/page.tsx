import { MetricChip, SectionCard } from "@sporx/ui";
import { adminApiGet } from "../../_lib/admin-api";

type TeamIdentityRules = {
  manualMergeGroups: string[][];
  manualBlockPairs: Array<{ leftTeamId: string; rightTeamId: string }>;
};

type TeamIdentityIssueVariant = {
  id: string;
  name: string;
  shortName: string | null;
  country: string | null;
  dataSource: string | null;
  totalMatches: number;
  providerMappings: number;
  isCanonical: boolean;
};

type TeamIdentityActionCandidate = {
  teamId: string;
  teamName: string;
  blocked: boolean;
  mergeRecommended: boolean;
  reason: string;
};

type TeamIdentityIssue = {
  normalizedName: string;
  riskLevel: "low" | "medium" | "high";
  reason: string;
  autoMerged: boolean;
  canonicalTeamId: string;
  canonicalTeamName: string;
  countrySet: string[];
  blockedPairCount: number;
  teamIds: string[];
  variants: TeamIdentityIssueVariant[];
  actionCandidates: TeamIdentityActionCandidate[];
};

type TeamIdentityIssuesResponse = {
  summary: {
    totalTeams: number;
    canonicalTeams: number;
    mergedTeams: number;
    manualMergeGroups: number;
    manualBlockPairs: number;
    issueGroups: number;
  };
  rules: TeamIdentityRules;
  issues: TeamIdentityIssue[];
};

interface TeamIdentityPageProps {
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

function riskToneClass(risk: TeamIdentityIssue["riskLevel"]) {
  if (risk === "high") {
    return "border-red-700 bg-red-950/40 text-red-200";
  }
  if (risk === "medium") {
    return "border-amber-700 bg-amber-950/40 text-amber-200";
  }
  return "border-emerald-700 bg-emerald-950/40 text-emerald-200";
}

function riskLabel(risk: TeamIdentityIssue["riskLevel"]) {
  if (risk === "high") {
    return "Yüksek Risk";
  }
  if (risk === "medium") {
    return "İzleme";
  }
  return "Stabil";
}

export default async function TeamIdentityPage({ searchParams }: TeamIdentityPageProps) {
  const params = await searchParams;
  const result = await adminApiGet<TeamIdentityIssuesResponse>("/api/v1/admin/teams/identity/issues?limit=140");

  return (
    <div className="space-y-4">
      <SectionCard title="Takım Kimlik Eşleştirme" subtitle="Duplicate takım kayıtlarını kontrol edin, manuel birleştirme ve engelleme kurallarını yönetin.">
        {params.updated === "1" ? (
          <p className="rounded-md border border-emerald-800 bg-emerald-950/40 p-3 text-sm text-emerald-200">
            Kural güncellendi. Kimlik eşleştirme haritası yenilendi.
          </p>
        ) : null}

        {params.error ? (
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">
            {errorText[params.error] ?? "İşlem başarısız."}
          </p>
        ) : null}

        <p className="mt-3 text-xs text-slate-400">
          Bu ekran sadece takım kimlik tutarlılığı içindir. Amaç, aynı kulübün farklı provider kayıtlarını tek kanonik kimlikte toplamak ve yanlış
          birleşmeleri engellemektir.
        </p>
      </SectionCard>

      {!result.ok ? (
        <SectionCard title="Kimlik Analizi" subtitle="API erişim hatası">
          <p className="rounded-md border border-red-900 bg-red-950/40 p-3 text-sm text-red-200">{result.error}</p>
        </SectionCard>
      ) : null}

      {result.ok && result.data ? (
        <>
          <SectionCard title="Özet" subtitle="Kimlik birleştirme kapsamı">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
              <MetricChip label="Toplam Takım" value={result.data.summary.totalTeams} />
              <MetricChip label="Kanonik Takım" value={result.data.summary.canonicalTeams} />
              <MetricChip label="Birleşen Kayıt" value={result.data.summary.mergedTeams} />
              <MetricChip label="Şüpheli Grup" value={result.data.summary.issueGroups} />
              <MetricChip label="Manuel Merge" value={result.data.summary.manualMergeGroups} />
              <MetricChip label="Engellenen Çift" value={result.data.summary.manualBlockPairs} />
            </div>
          </SectionCard>

          <SectionCard title="Manuel Kurallar" subtitle="Aktif merge ve block kuralları">
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-md border border-slate-700 bg-slate-950/40 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-200">Manuel Birleştirme Grupları</p>
                {result.data.rules.manualMergeGroups.length === 0 ? (
                  <p className="text-xs text-slate-400">Aktif manuel birleştirme kuralı yok.</p>
                ) : (
                  <ul className="space-y-2 text-xs text-slate-300">
                    {result.data.rules.manualMergeGroups.slice(0, 20).map((group) => (
                      <li key={group.join(",")} className="rounded border border-slate-700 bg-slate-900/60 p-2">
                        <div className="mb-2 flex flex-wrap gap-1">
                          {group.map((id) => (
                            <span key={id} className="rounded border border-slate-600 px-2 py-0.5 text-[11px] text-slate-300">
                              {shortId(id)}
                            </span>
                          ))}
                        </div>
                        <form action="/api/admin/teams/identity/action?next=/admin/teams/identity" method="post">
                          <input type="hidden" name="action" value="unmerge_group" />
                          <input type="hidden" name="teamIds" value={group.join(",")} />
                          <button
                            type="submit"
                            className="rounded border border-amber-700 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-900/40"
                          >
                            Manuel Birleştirmeyi Kaldır
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="rounded-md border border-slate-700 bg-slate-950/40 p-3">
                <p className="mb-2 text-sm font-semibold text-slate-200">Engellenen Çiftler</p>
                {result.data.rules.manualBlockPairs.length === 0 ? (
                  <p className="text-xs text-slate-400">Aktif engelleme kuralı yok.</p>
                ) : (
                  <ul className="space-y-2 text-xs text-slate-300">
                    {result.data.rules.manualBlockPairs.slice(0, 30).map((pair) => (
                      <li key={`${pair.leftTeamId}::${pair.rightTeamId}`} className="rounded border border-slate-700 bg-slate-900/60 p-2">
                        <p className="mb-2">
                          {shortId(pair.leftTeamId)} ↔ {shortId(pair.rightTeamId)}
                        </p>
                        <form action="/api/admin/teams/identity/action?next=/admin/teams/identity" method="post">
                          <input type="hidden" name="action" value="unblock_pair" />
                          <input type="hidden" name="leftTeamId" value={pair.leftTeamId} />
                          <input type="hidden" name="rightTeamId" value={pair.rightTeamId} />
                          <button
                            type="submit"
                            className="rounded border border-emerald-700 bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-900/40"
                          >
                            Engeli Kaldır
                          </button>
                        </form>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Şüpheli Gruplar" subtitle="Yüksek ve orta riskli isim kümeleri">
            {result.data.issues.length === 0 ? (
              <p className="text-sm text-slate-300">İncelenecek duplicate grup bulunamadı.</p>
            ) : (
              <div className="space-y-4">
                {result.data.issues.map((issue) => (
                  <article key={`${issue.normalizedName}-${issue.canonicalTeamId}`} className="rounded-lg border border-slate-700 bg-slate-900/40 p-4">
                    <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-slate-100">{issue.canonicalTeamName}</p>
                        <p className="text-xs text-slate-400">Normalize isim: {issue.normalizedName}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded border px-2 py-1 text-xs ${riskToneClass(issue.riskLevel)}`}>{riskLabel(issue.riskLevel)}</span>
                        <span className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-300">
                          Varyant: {issue.variants.length}
                        </span>
                        <span className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-300">
                          Auto Merge: {issue.autoMerged ? "Evet" : "Hayır"}
                        </span>
                        {issue.countrySet.length > 0 ? (
                          <span className="rounded border border-slate-700 bg-slate-950/60 px-2 py-1 text-xs text-slate-300">
                            Ülkeler: {issue.countrySet.join(", ")}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <p className="mb-3 text-xs text-slate-300">{issue.reason}</p>

                    <div className="mb-3 overflow-x-auto rounded-md border border-slate-700">
                      <table className="min-w-full divide-y divide-slate-700 text-xs">
                        <thead className="bg-slate-950/70">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-300">Takım</th>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-300">Ülke</th>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-300">Kaynak</th>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-300">Maç</th>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-300">Mapping</th>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-300">ID</th>
                            <th className="px-2 py-1.5 text-left font-medium text-slate-300">Durum</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                          {issue.variants.map((variant) => (
                            <tr key={variant.id} className="bg-slate-900/30">
                              <td className="px-2 py-1.5 text-slate-100">{variant.name}</td>
                              <td className="px-2 py-1.5 text-slate-300">{variant.country || "-"}</td>
                              <td className="px-2 py-1.5 text-slate-300">{variant.dataSource || "-"}</td>
                              <td className="px-2 py-1.5 text-slate-300">{variant.totalMatches}</td>
                              <td className="px-2 py-1.5 text-slate-300">{variant.providerMappings}</td>
                              <td className="px-2 py-1.5 text-slate-300">{shortId(variant.id)}</td>
                              <td className="px-2 py-1.5">
                                {variant.isCanonical ? (
                                  <span className="rounded border border-emerald-700 bg-emerald-950/40 px-2 py-0.5 text-[11px] text-emerald-200">
                                    Kanonik
                                  </span>
                                ) : (
                                  <span className="rounded border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[11px] text-slate-300">
                                    Varyant
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="mb-3 flex flex-wrap gap-2">
                      <form action="/api/admin/teams/identity/action?next=/admin/teams/identity" method="post">
                        <input type="hidden" name="action" value="merge_group" />
                        <input type="hidden" name="teamIds" value={issue.teamIds.join(",")} />
                        <button
                          type="submit"
                          className="rounded border border-cyan-700 bg-cyan-950/40 px-2.5 py-1.5 text-xs text-cyan-200 hover:bg-cyan-900/40"
                        >
                          Grubu Manuel Birleştir
                        </button>
                      </form>
                    </div>

                    {issue.actionCandidates.length > 0 ? (
                      <div className="grid gap-2 md:grid-cols-2">
                        {issue.actionCandidates.map((candidate) => (
                          <div key={candidate.teamId} className="rounded border border-slate-700 bg-slate-950/40 p-2">
                            <p className="text-xs font-medium text-slate-200">
                              {candidate.teamName} ({shortId(candidate.teamId)})
                            </p>
                            <p className="mt-1 text-[11px] text-slate-400">{candidate.reason}</p>

                            <div className="mt-2 flex flex-wrap gap-2">
                              {candidate.blocked ? (
                                <form action="/api/admin/teams/identity/action?next=/admin/teams/identity" method="post">
                                  <input type="hidden" name="action" value="unblock_pair" />
                                  <input type="hidden" name="leftTeamId" value={issue.canonicalTeamId} />
                                  <input type="hidden" name="rightTeamId" value={candidate.teamId} />
                                  <button
                                    type="submit"
                                    className="rounded border border-emerald-700 bg-emerald-950/40 px-2 py-1 text-[11px] text-emerald-200 hover:bg-emerald-900/40"
                                  >
                                    Engeli Kaldır
                                  </button>
                                </form>
                              ) : (
                                <form action="/api/admin/teams/identity/action?next=/admin/teams/identity" method="post">
                                  <input type="hidden" name="action" value="block_pair" />
                                  <input type="hidden" name="leftTeamId" value={issue.canonicalTeamId} />
                                  <input type="hidden" name="rightTeamId" value={candidate.teamId} />
                                  <button
                                    type="submit"
                                    className="rounded border border-amber-700 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-200 hover:bg-amber-900/40"
                                  >
                                    Bu Eşleşmeyi Engelle
                                  </button>
                                </form>
                              )}

                              <form action="/api/admin/teams/identity/action?next=/admin/teams/identity" method="post">
                                <input type="hidden" name="action" value="merge_group" />
                                <input type="hidden" name="teamIds" value={`${issue.canonicalTeamId},${candidate.teamId}`} />
                                <button
                                  type="submit"
                                  disabled={candidate.blocked}
                                  className={`rounded border px-2 py-1 text-[11px] ${
                                    candidate.blocked
                                      ? "cursor-not-allowed border-slate-700 bg-slate-900/50 text-slate-500"
                                      : candidate.mergeRecommended
                                        ? "border-cyan-700 bg-cyan-950/40 text-cyan-200 hover:bg-cyan-900/40"
                                        : "border-slate-700 bg-slate-900/60 text-slate-300 hover:bg-slate-800/70"
                                  }`}
                                >
                                  Çifti Birleştir
                                </button>
                              </form>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
