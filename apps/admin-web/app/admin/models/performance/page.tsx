import { MetricChip, SectionCard } from "@sporx/ui";
import { adminApiGet } from "../../_lib/admin-api";

type PerformanceRow = {
  id: string;
  modelVersionId: string;
  measuredAt: string;
  metrics: unknown;
};

type ParsedMetrics = {
  accuracy: number | null;
  brier: number | null;
  logLoss: number | null;
  extra: Record<string, number>;
};

function shortId(value: string): string {
  if (value.length <= 16) {
    return value;
  }
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseMetrics(input: unknown): ParsedMetrics {
  const toObject = (value: unknown): Record<string, unknown> | null => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
    return null;
  };

  const raw = toObject(input) ?? {};
  const accuracy = asNumber(raw.accuracy);
  const brier = asNumber(raw.brier);
  const logLoss = asNumber(raw.logLoss ?? raw.log_loss);
  const extra: Record<string, number> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (key === "accuracy" || key === "brier" || key === "logLoss" || key === "log_loss") {
      continue;
    }
    const numeric = asNumber(value);
    if (numeric !== null) {
      extra[key] = numeric;
    }
  }

  return { accuracy, brier, logLoss, extra };
}

function avg(values: Array<number | null>): number | null {
  const normalized = values.filter((x): x is number => x !== null);
  if (normalized.length === 0) {
    return null;
  }
  return normalized.reduce((sum, item) => sum + item, 0) / normalized.length;
}

function formatMetric(value: number | null, digits = 3): string {
  if (value === null) {
    return "-";
  }
  return value.toFixed(digits);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(date);
}

function metricTone(value: number | null, kind: "accuracy" | "loss"): string {
  if (value === null) {
    return "text-slate-300";
  }

  if (kind === "accuracy") {
    if (value >= 0.6) {
      return "text-emerald-300";
    }
    if (value >= 0.55) {
      return "text-amber-300";
    }
    return "text-red-300";
  }

  if (value <= 0.2) {
    return "text-emerald-300";
  }
  if (value <= 0.35) {
    return "text-amber-300";
  }
  return "text-red-300";
}

function sparkline(values: number[], mode: "higher-better" | "lower-better") {
  if (values.length === 0) {
    return <p className="text-xs text-slate-400">Trend verisi yok</p>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const first = values[0];
  const last = values[values.length - 1];
  const improved = mode === "higher-better" ? last >= first : last <= first;

  return (
    <div>
      <div className="mb-1 h-10 w-full rounded bg-slate-900/70 p-1">
        <div className="flex h-full items-end gap-1">
          {values.map((point, idx) => {
            const normalized = (point - min) / range;
            const height = Math.max(12, Math.round(normalized * 32) + 8);
            return (
              <div
                key={`${idx}-${point}`}
                className={`flex-1 rounded-sm ${improved ? "bg-emerald-500/70" : "bg-amber-500/70"}`}
                style={{ height }}
                title={point.toFixed(3)}
              />
            );
          })}
        </div>
      </div>
      <p className={`text-xs ${improved ? "text-emerald-300" : "text-amber-300"}`}>
        {improved ? "Trend iyilesiyor" : "Trend dalgali / geriliyor"}
      </p>
    </div>
  );
}

export default async function Page() {
  const result = await adminApiGet<PerformanceRow[]>("/api/v1/admin/models/performance-timeseries");

  if (!result.ok) {
    return (
      <SectionCard title="Model Performansi" subtitle="Performance timeseries">
        <p className="rounded-md border border-red-900/70 bg-red-950/40 p-3 text-sm text-red-200">{result.error}</p>
      </SectionCard>
    );
  }

  const rows = (result.data ?? []).map((row) => ({ ...row, parsed: parseMetrics(row.metrics) }));

  if (rows.length === 0) {
    return (
      <SectionCard title="Model Performansi" subtitle="Performance timeseries">
        <p className="text-sm text-slate-300">Henuz performans verisi yok.</p>
      </SectionCard>
    );
  }

  const uniqueModelIds = Array.from(new Set(rows.map((item) => item.modelVersionId)));
  const modelLabelMap = new Map<string, string>();
  uniqueModelIds.forEach((id, index) => {
    modelLabelMap.set(id, `Model ${index + 1}`);
  });

  const averageAccuracy = avg(rows.map((item) => item.parsed.accuracy));
  const averageBrier = avg(rows.map((item) => item.parsed.brier));
  const averageLogLoss = avg(rows.map((item) => item.parsed.logLoss));
  const newest = rows
    .slice()
    .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime())[0];

  const grouped = uniqueModelIds.map((modelId) => {
    const series = rows
      .filter((item) => item.modelVersionId === modelId)
      .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime());

    const latest = series[series.length - 1];
    return { modelId, series, latest };
  });

  const tableRows = rows
    .slice()
    .sort((a, b) => new Date(b.measuredAt).getTime() - new Date(a.measuredAt).getTime())
    .slice(0, 30);

  return (
    <div className="space-y-4">
      <SectionCard title="Model Performansi" subtitle="Model kalite ozeti ve trend gorunumu">
        <div className="mb-4 rounded-md border border-cyan-900/50 bg-cyan-950/30 p-3 text-sm text-cyan-100">
          Bu ekran ham JSON metriklerini okunabilir KPI kartlari ve model bazli trend gorunumune donusturur.
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <MetricChip label="Toplam Olcum" value={rows.length} />
          <MetricChip label="Model Sayisi" value={uniqueModelIds.length} />
          <MetricChip label="Ortalama Accuracy" value={formatMetric(averageAccuracy)} />
          <MetricChip label="Ortalama Brier" value={formatMetric(averageBrier)} />
          <MetricChip label="Ortalama LogLoss" value={formatMetric(averageLogLoss)} />
        </div>

        <p className="mt-3 text-xs text-slate-400">
          Son olcum: {newest ? `${formatDate(newest.measuredAt)} (${modelLabelMap.get(newest.modelVersionId)})` : "-"}
        </p>
      </SectionCard>

      <SectionCard title="Model Bazli Trend" subtitle="Her model icin son performans sinyalleri">
        <div className="grid gap-3 lg:grid-cols-2">
          {grouped.map(({ modelId, series, latest }) => {
            const accSeries = series.map((x) => x.parsed.accuracy).filter((x): x is number => x !== null).slice(-12);
            const brierSeries = series.map((x) => x.parsed.brier).filter((x): x is number => x !== null).slice(-12);
            const logLossSeries = series.map((x) => x.parsed.logLoss).filter((x): x is number => x !== null).slice(-12);

            return (
              <div key={modelId} className="rounded-lg border border-slate-700 bg-slate-900/40 p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-100">{modelLabelMap.get(modelId)}</p>
                    <p className="text-xs text-slate-400">{shortId(modelId)}</p>
                  </div>
                  <p className="text-xs text-slate-400">{latest ? formatDate(latest.measuredAt) : "-"}</p>
                </div>

                <div className="mb-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Accuracy</p>
                    <p className={`text-sm font-semibold ${metricTone(latest?.parsed.accuracy ?? null, "accuracy")}`}>
                      {formatMetric(latest?.parsed.accuracy ?? null)}
                    </p>
                  </div>
                  <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">Brier</p>
                    <p className={`text-sm font-semibold ${metricTone(latest?.parsed.brier ?? null, "loss")}`}>
                      {formatMetric(latest?.parsed.brier ?? null)}
                    </p>
                  </div>
                  <div className="rounded border border-slate-700 bg-slate-950/40 p-2">
                    <p className="text-[11px] uppercase tracking-wide text-slate-400">LogLoss</p>
                    <p className={`text-sm font-semibold ${metricTone(latest?.parsed.logLoss ?? null, "loss")}`}>
                      {formatMetric(latest?.parsed.logLoss ?? null)}
                    </p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div>
                    <p className="mb-1 text-xs text-slate-400">Accuracy trend</p>
                    {sparkline(accSeries, "higher-better")}
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-400">Brier trend</p>
                    {sparkline(brierSeries, "lower-better")}
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-slate-400">LogLoss trend</p>
                    {sparkline(logLossSeries, "lower-better")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </SectionCard>

      <SectionCard title="Son Olcumler" subtitle="Detayli ve okunabilir performans tablosu">
        <div className="overflow-x-auto rounded-md border border-slate-700">
          <table className="min-w-full divide-y divide-slate-700 text-sm">
            <thead className="bg-slate-950/70">
              <tr>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Model</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Olcum Zamani</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Accuracy</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Brier</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">LogLoss</th>
                <th className="px-3 py-2 text-left font-medium text-slate-300">Ek Metrikler</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {tableRows.map((row) => {
                const extras = Object.entries(row.parsed.extra)
                  .slice(0, 3)
                  .map(([key, value]) => `${key}: ${value.toFixed(3)}`)
                  .join(" | ");

                return (
                  <tr key={row.id} className="bg-slate-900/30">
                    <td className="px-3 py-2 text-slate-100">
                      <p className="font-medium">{modelLabelMap.get(row.modelVersionId)}</p>
                      <p className="text-xs text-slate-400">{shortId(row.modelVersionId)}</p>
                    </td>
                    <td className="px-3 py-2 text-slate-100">{formatDate(row.measuredAt)}</td>
                    <td className={`px-3 py-2 ${metricTone(row.parsed.accuracy, "accuracy")}`}>
                      {formatMetric(row.parsed.accuracy)}
                    </td>
                    <td className={`px-3 py-2 ${metricTone(row.parsed.brier, "loss")}`}>{formatMetric(row.parsed.brier)}</td>
                    <td className={`px-3 py-2 ${metricTone(row.parsed.logLoss, "loss")}`}>
                      {formatMetric(row.parsed.logLoss)}
                    </td>
                    <td className="max-w-[360px] px-3 py-2 text-xs text-slate-300">{extras || "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </div>
  );
}
