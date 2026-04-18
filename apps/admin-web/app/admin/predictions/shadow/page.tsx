import { SectionCard } from "@sporx/ui";
import { adminApiGet } from "../../_lib/admin-api";

type ShadowSummary = {
  sampleSize: number;
  coverageRate: number;
  oddsCoverageRate: number;
  duplicateRate: number;
  leakageRate: number;
  avgLatencyMsNew: number | null;
  avgOldLogLoss: number | null;
  avgNewLogLoss: number | null;
  avgOldBrier: number | null;
  avgNewBrier: number | null;
};

type ShadowComparisonResponse = {
  summary: ShadowSummary;
  rows: Array<Record<string, unknown>>;
};

type LeakageResponse = {
  summary: {
    checks: number;
    violations: number;
    violationRate: number;
    sourceLeakRows: number;
    oddsLeakRows: number;
  };
  rows: Array<Record<string, unknown>>;
};

type FailureResponse = {
  summary: { totalFailures: number };
  reasons: Array<{ errorCode: string; count: number }>;
  rows: Array<Record<string, unknown>>;
};

type DuplicateResponse = {
  summary: { dedupKeys: number; totalSuppressed: number };
  rows: Array<{
    dedupKey: string;
    suppressedCount: number;
    horizon: string | null;
    market: string | null;
    lastSuppressedAt: string;
  }>;
};

type RolloutResponse = {
  settings: {
    mode: "legacy" | "new" | "shadow" | "percentage";
    percentage: number;
    internalOnly: boolean;
    emergencyRollback: boolean;
  };
  sourcePreview: Array<{ seed: string; source: "legacy" | "published" }>;
};

function formatPct(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return `%${(value * 100).toFixed(1)}`;
}

function formatMetric(value: number | null, digits = 3) {
  if (value === null || Number.isNaN(value)) {
    return "-";
  }
  return value.toFixed(digits);
}

function asArray<T>(value: T[] | null | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return fallback;
}

function asNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return null;
}

function asBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return fallback;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value === "string") {
    return value;
  }
  return fallback;
}

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  return null;
}

export default async function ShadowPipelinePage() {
  const [comparisonResult, leakageResult, failureResult, duplicateResult, rolloutResult] = await Promise.all([
    adminApiGet<ShadowComparisonResponse>("/api/v1/admin/predictions/shadow/comparison"),
    adminApiGet<LeakageResponse>("/api/v1/admin/predictions/shadow/leakage"),
    adminApiGet<FailureResponse>("/api/v1/admin/predictions/shadow/publish-failures"),
    adminApiGet<DuplicateResponse>("/api/v1/admin/predictions/shadow/duplicate-suppression"),
    adminApiGet<RolloutResponse>("/api/v1/admin/predictions/rollout")
  ]);

  const comparisonObj = comparisonResult.ok ? asRecord(comparisonResult.data) : null;
  const comparisonSummaryObj = asRecord(comparisonObj?.summary);
  const comparison =
    comparisonObj && comparisonSummaryObj
      ? ({
          summary: {
            sampleSize: asNumber(comparisonSummaryObj.sampleSize),
            coverageRate: asNumber(comparisonSummaryObj.coverageRate),
            oddsCoverageRate: asNumber(comparisonSummaryObj.oddsCoverageRate),
            duplicateRate: asNumber(comparisonSummaryObj.duplicateRate),
            leakageRate: asNumber(comparisonSummaryObj.leakageRate),
            avgLatencyMsNew: asNullableNumber(comparisonSummaryObj.avgLatencyMsNew),
            avgOldLogLoss: asNullableNumber(comparisonSummaryObj.avgOldLogLoss),
            avgNewLogLoss: asNullableNumber(comparisonSummaryObj.avgNewLogLoss),
            avgOldBrier: asNullableNumber(comparisonSummaryObj.avgOldBrier),
            avgNewBrier: asNullableNumber(comparisonSummaryObj.avgNewBrier)
          },
          rows: asArray<Record<string, unknown>>(comparisonObj.rows as Array<Record<string, unknown>> | null | undefined)
        } satisfies ShadowComparisonResponse)
      : null;

  const leakageObj = leakageResult.ok ? asRecord(leakageResult.data) : null;
  const leakageSummaryObj = asRecord(leakageObj?.summary);
  const leakage =
    leakageObj && leakageSummaryObj
      ? ({
          summary: {
            checks: asNumber(leakageSummaryObj.checks),
            violations: asNumber(leakageSummaryObj.violations),
            violationRate: asNumber(leakageSummaryObj.violationRate),
            sourceLeakRows: asNumber(leakageSummaryObj.sourceLeakRows),
            oddsLeakRows: asNumber(leakageSummaryObj.oddsLeakRows)
          },
          rows: asArray<Record<string, unknown>>(leakageObj.rows as Array<Record<string, unknown>> | null | undefined)
        } satisfies LeakageResponse)
      : null;

  const failuresObj = failureResult.ok ? asRecord(failureResult.data) : null;
  const failureSummaryObj = asRecord(failuresObj?.summary);
  const failures =
    failuresObj && failureSummaryObj
      ? ({
          summary: { totalFailures: asNumber(failureSummaryObj.totalFailures) },
          reasons: asArray<Record<string, unknown>>(failuresObj.reasons as Array<Record<string, unknown>> | null | undefined).map((row) => ({
            errorCode: asString(row.errorCode, "UNKNOWN"),
            count: asNumber(row.count)
          })),
          rows: asArray<Record<string, unknown>>(failuresObj.rows as Array<Record<string, unknown>> | null | undefined)
        } satisfies FailureResponse)
      : null;

  const duplicatesObj = duplicateResult.ok ? asRecord(duplicateResult.data) : null;
  const duplicateSummaryObj = asRecord(duplicatesObj?.summary);
  const duplicates =
    duplicatesObj && duplicateSummaryObj
      ? ({
          summary: {
            dedupKeys: asNumber(duplicateSummaryObj.dedupKeys),
            totalSuppressed: asNumber(duplicateSummaryObj.totalSuppressed)
          },
          rows: asArray<Record<string, unknown>>(duplicatesObj.rows as Array<Record<string, unknown>> | null | undefined).map((row) => ({
            dedupKey: asString(row.dedupKey),
            suppressedCount: asNumber(row.suppressedCount),
            horizon: asNullableString(row.horizon),
            market: asNullableString(row.market),
            lastSuppressedAt: asString(row.lastSuppressedAt)
          }))
        } satisfies DuplicateResponse)
      : null;

  const rolloutObj = rolloutResult.ok ? asRecord(rolloutResult.data) : null;
  const rolloutSettingsObj = asRecord(rolloutObj?.settings);
  const rollout =
    rolloutObj && rolloutSettingsObj
      ? ({
          settings: {
            mode:
              asString(rolloutSettingsObj.mode) === "legacy" ||
              asString(rolloutSettingsObj.mode) === "new" ||
              asString(rolloutSettingsObj.mode) === "shadow" ||
              asString(rolloutSettingsObj.mode) === "percentage"
                ? (asString(rolloutSettingsObj.mode) as "legacy" | "new" | "shadow" | "percentage")
                : "legacy",
            percentage: asNumber(rolloutSettingsObj.percentage),
            internalOnly: asBoolean(rolloutSettingsObj.internalOnly),
            emergencyRollback: asBoolean(rolloutSettingsObj.emergencyRollback)
          },
          sourcePreview: asArray<Record<string, unknown>>(
            rolloutObj.sourcePreview as Array<Record<string, unknown>> | null | undefined
          ).map((row) => ({
            seed: asString(row.seed),
            source: asString(row.source) === "published" ? "published" : "legacy"
          }))
        } satisfies RolloutResponse)
      : null;

  const anyError = [comparisonResult, leakageResult, failureResult, duplicateResult, rolloutResult].some(
    (item) => !item.ok
  );

  return (
    <div className="space-y-4">
      <SectionCard title="Shadow Cutover" subtitle="Pipeline v1 vs v2 validation and rollout monitor">
        {anyError ? (
          <p className="mb-3 rounded-md border border-amber-900/60 bg-amber-950/40 p-3 text-sm text-amber-200">
            Bazi endpointler yanit vermedi. Gosterim mevcut verilerle devam ediyor.
          </p>
        ) : null}

        {comparison ? (
          <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-5">
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Sample</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{comparison.summary.sampleSize}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Coverage</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{formatPct(comparison.summary.coverageRate)}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Odds Coverage</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{formatPct(comparison.summary.oddsCoverageRate)}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Duplicate Rate</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{formatPct(comparison.summary.duplicateRate)}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Leakage Rate</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{formatPct(comparison.summary.leakageRate)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-300">Shadow comparison verisi bulunamadi.</p>
        )}
      </SectionCard>

      <SectionCard title="Model Delta" subtitle="Old vs new calibration metrics">
        {comparison ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Old LogLoss</p>
              <p className="mt-1 text-base font-semibold text-slate-100">{formatMetric(comparison.summary.avgOldLogLoss)}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">New LogLoss</p>
              <p className="mt-1 text-base font-semibold text-slate-100">{formatMetric(comparison.summary.avgNewLogLoss)}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Old Brier</p>
              <p className="mt-1 text-base font-semibold text-slate-100">{formatMetric(comparison.summary.avgOldBrier)}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">New Brier</p>
              <p className="mt-1 text-base font-semibold text-slate-100">{formatMetric(comparison.summary.avgNewBrier)}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Latency (ms)</p>
              <p className="mt-1 text-base font-semibold text-slate-100">{formatMetric(comparison.summary.avgLatencyMsNew, 1)}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-300">Model delta verisi bulunamadi.</p>
        )}
      </SectionCard>

      <SectionCard title="Leakage Checks" subtitle="Feature and odds cutoff safety">
        {leakage ? (
          <div className="grid gap-3 md:grid-cols-4">
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Checks</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{leakage.summary.checks}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Violations</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{leakage.summary.violations}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Source Leak Rows</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{leakage.summary.sourceLeakRows}</p>
            </div>
            <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
              <p className="text-xs uppercase text-slate-400">Odds Leak Rows</p>
              <p className="mt-1 text-lg font-semibold text-slate-100">{leakage.summary.oddsLeakRows}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-300">Leakage raporu bulunamadi.</p>
        )}
      </SectionCard>

      <SectionCard title="Publish Failures" subtitle="Failure reasons and counts">
        {!failures || failures.reasons.length === 0 ? (
          <p className="text-sm text-slate-300">Publish failure kaydi bulunmuyor.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="min-w-full divide-y divide-slate-700 text-sm">
              <thead className="bg-slate-950/70">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-300">Error Code</th>
                  <th className="px-3 py-2 text-left text-slate-300">Count</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {asArray(failures.reasons).map((row) => (
                  <tr key={row.errorCode} className="bg-slate-900/30">
                    <td className="px-3 py-2 text-slate-100">{row.errorCode}</td>
                    <td className="px-3 py-2 text-slate-100">{row.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Duplicate Suppression" subtitle="Dedup stats for queue idempotency">
        {!duplicates || duplicates.rows.length === 0 ? (
          <p className="text-sm text-slate-300">Duplicate suppression kaydi bulunmuyor.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-slate-700">
            <table className="min-w-full divide-y divide-slate-700 text-sm">
              <thead className="bg-slate-950/70">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-300">Dedup Key</th>
                  <th className="px-3 py-2 text-left text-slate-300">Suppressed</th>
                  <th className="px-3 py-2 text-left text-slate-300">Market</th>
                  <th className="px-3 py-2 text-left text-slate-300">Horizon</th>
                  <th className="px-3 py-2 text-left text-slate-300">Last Seen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {asArray(duplicates.rows).slice(0, 50).map((row) => (
                  <tr key={row.dedupKey} className="bg-slate-900/30">
                    <td className="px-3 py-2 text-slate-100">{row.dedupKey}</td>
                    <td className="px-3 py-2 text-slate-100">{row.suppressedCount}</td>
                    <td className="px-3 py-2 text-slate-100">{row.market ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-100">{row.horizon ?? "-"}</td>
                    <td className="px-3 py-2 text-slate-100">{row.lastSuppressedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Rollout Status" subtitle="Feature-flag controlled source cutover">
        {!rollout ? (
          <p className="text-sm text-slate-300">Rollout ayarlari alinamadi.</p>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-xs uppercase text-slate-400">Mode</p>
                <p className="mt-1 text-base font-semibold text-slate-100">{rollout.settings.mode}</p>
              </div>
              <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-xs uppercase text-slate-400">Percentage</p>
                <p className="mt-1 text-base font-semibold text-slate-100">{rollout.settings.percentage}%</p>
              </div>
              <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-xs uppercase text-slate-400">Internal Only</p>
                <p className="mt-1 text-base font-semibold text-slate-100">{rollout.settings.internalOnly ? "true" : "false"}</p>
              </div>
              <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
                <p className="text-xs uppercase text-slate-400">Emergency Rollback</p>
                <p className="mt-1 text-base font-semibold text-slate-100">{rollout.settings.emergencyRollback ? "true" : "false"}</p>
              </div>
            </div>
            <div className="overflow-x-auto rounded-md border border-slate-700">
              <table className="min-w-full divide-y divide-slate-700 text-sm">
                <thead className="bg-slate-950/70">
                  <tr>
                    <th className="px-3 py-2 text-left text-slate-300">Seed</th>
                    <th className="px-3 py-2 text-left text-slate-300">Selected Source</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {asArray(rollout.sourcePreview).map((row) => (
                    <tr key={row.seed} className="bg-slate-900/30">
                      <td className="px-3 py-2 text-slate-100">{row.seed}</td>
                      <td className="px-3 py-2 text-slate-100">{row.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
