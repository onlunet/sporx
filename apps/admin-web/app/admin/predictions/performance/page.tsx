import { MetricChip, SectionCard } from "@sporx/ui";
import { adminApiGet } from "../../_lib/admin-api";
import {
  PerformanceTimeseriesRow,
  ModelComparisonRow,
  LowConfidenceRow,
  FailedPredictionRow,
  PredictionTypePerformanceItem,
  PredictionTypeStatus,
  PredictionVarianceItem,
  statusFromMetrics,
  resolveFilters,
  buildPredictionTypeRows,
  buildLineRows,
  buildSummary,
  buildConfidenceBuckets,
  buildVarianceRows,
  buildTrendPoints,
  applyFilters
} from "../../../../src/admin/prediction-performance-utils";

interface PerformancePageProps {
  searchParams: Promise<{
    sport?: string;
    league?: string;
    predictionType?: string;
    modelVersion?: string;
    dateFrom?: string;
    dateTo?: string;
    line?: string;
    minSampleSize?: string;
  }>;
}

type TrendDirection = "up" | "down" | "flat";

type ModelScoreRow = {
  modelVersionId: string;
  sampleSize: number;
  accuracy: number | null;
  brierScore: number | null;
  logLoss: number | null;
  winCount: number;
  status: PredictionTypeStatus;
};

function avg(values: Array<number | null>): number | null {
  const valid = values.filter((x): x is number => x !== null);
  if (valid.length === 0) {
    return null;
  }
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
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

function shortModel(value: string): string {
  return `${value.slice(0, 8)}...${value.slice(-4)}`;
}

function formatPct(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return `%${(value * 100).toFixed(1)}`;
}

function formatMetric(value: number | null): string {
  if (value === null) {
    return "-";
  }
  return value.toFixed(3);
}

function statusTone(status: PredictionTypeStatus) {
  if (status === "strong") {
    return "border-emerald-700/70 bg-emerald-950/40 text-emerald-200";
  }
  if (status === "stable") {
    return "border-cyan-700/70 bg-cyan-950/40 text-cyan-200";
  }
  if (status === "watch") {
    return "border-amber-700/70 bg-amber-950/40 text-amber-200";
  }
  return "border-rose-700/70 bg-rose-950/40 text-rose-200";
}

function trendLabel(trend: TrendDirection) {
  if (trend === "up") {
    return "Iyilesiyor";
  }
  if (trend === "down") {
    return "Geriliyor";
  }
  return "Yatay";
}

function typeLabel(value: string) {
  const map: Record<string, string> = {
    fullTimeResult: "Mac Sonucu",
    firstHalfResult: "Ilk Yari Sonucu",
    halfTimeFullTime: "IY/MS",
    bothTeamsToScore: "KG Var/Yok",
    totalGoalsOverUnder: "Alt/Ust",
    correctScore: "Dogru Skor",
    goalRange: "Gol Araligi",
    firstHalfGoals: "Ilk Yari Golleri",
    secondHalfGoals: "Ikinci Yari Golleri"
  };
  return map[value] ?? value;
}

function varianceLabel(value: string) {
  const map: Record<string, string> = {
    LOW_CONFIDENCE: "Dusuk Guven",
    MEDIUM_VARIANCE: "Orta Oynaklik",
    WEATHER_VARIANCE: "Hava Oynakligi",
    REFEREE_DATA_ESTIMATED: "Tahmini Hakem Verisi",
    lineup_shock: "Beklenmeyen Kadro Degisimi"
  };
  return map[value] ?? value;
}

function sparkline(values: number[]) {
  if (values.length === 0) {
    return <p className="text-xs text-slate-400">Trend verisi yok</p>;
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return (
    <div className="h-11 rounded bg-slate-900/70 p-1">
      <div className="flex h-full items-end gap-1">
        {values.map((item, idx) => {
          const normalized = (item - min) / range;
          const height = Math.max(10, Math.round(normalized * 30) + 8);
          return <span key={`${idx}-${item}`} className="flex-1 rounded-sm bg-cyan-500/80" style={{ height }} />;
        })}
      </div>
    </div>
  );
}

function ModelComparisonByType({
  rows,
  currentTypeLabel
}: {
  rows: ModelScoreRow[];
  currentTypeLabel: string;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-300">Model karsilastirmasi icin yeterli veri yok.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-700">
      <table className="min-w-full divide-y divide-slate-700 text-sm">
        <thead className="bg-slate-950/70">
          <tr>
            <th className="px-3 py-2 text-left text-slate-300">Model</th>
            <th className="px-3 py-2 text-left text-slate-300">Orneklem</th>
            <th className="px-3 py-2 text-left text-slate-300">Accuracy</th>
            <th className="px-3 py-2 text-left text-slate-300">Brier</th>
            <th className="px-3 py-2 text-left text-slate-300">LogLoss</th>
            <th className="px-3 py-2 text-left text-slate-300">Karsilastirma Kazanci</th>
            <th className="px-3 py-2 text-left text-slate-300">Durum</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((row) => (
            <tr key={row.modelVersionId} className="bg-slate-900/30">
              <td className="px-3 py-2 text-slate-100">
                <p className="font-medium">{shortModel(row.modelVersionId)}</p>
                <p className="text-xs text-slate-400">{currentTypeLabel}</p>
              </td>
              <td className="px-3 py-2 text-slate-100">{row.sampleSize}</td>
              <td className="px-3 py-2 text-slate-100">{formatMetric(row.accuracy)}</td>
              <td className="px-3 py-2 text-slate-100">{formatMetric(row.brierScore)}</td>
              <td className="px-3 py-2 text-slate-100">{formatMetric(row.logLoss)}</td>
              <td className="px-3 py-2 text-slate-100">{row.winCount}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex rounded-md border px-2 py-1 text-xs ${statusTone(row.status)}`}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfidenceBucketChart({ buckets }: { buckets: ReturnType<typeof buildConfidenceBuckets> }) {
  if (buckets.length === 0) {
    return <p className="text-sm text-slate-300">Confidence bucket verisi bulunmuyor.</p>;
  }

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      {buckets.map((bucket: (typeof buckets)[number]) => (
        <article key={bucket.key} className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
          <p className="text-sm font-semibold text-slate-100">{bucket.label}</p>
          <p className="mt-1 text-xs text-slate-400">Orneklem: {bucket.sampleSize}</p>
          <p className="text-xs text-slate-300">Ort. Guven: {formatPct(bucket.avgConfidenceScore)}</p>
          <p className="text-xs text-slate-300">Tahmini Basari: {formatPct(bucket.estimatedSuccessRate)}</p>
          <p className="text-xs text-slate-300">Kalibrasyon Acigi: {formatMetric(bucket.calibrationGap)}</p>
          <div className="mt-2">
            <span className={`inline-flex rounded-md border px-2 py-1 text-xs ${statusTone(bucket.status)}`}>{bucket.status}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function VarianceWarningPanel({ items }: { items: PredictionVarianceItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-300">Yuksek oynaklik sinyali bulunmuyor.</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key} className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-slate-100">{varianceLabel(item.label)}</p>
            <span className={`inline-flex rounded-md border px-2 py-1 text-xs ${statusTone(item.severity)}`}>
              {item.severity} ({item.count})
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-400">{item.note}</p>
        </li>
      ))}
    </ul>
  );
}

function PredictionTypePerformanceTable({ rows }: { rows: PredictionTypePerformanceItem[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-300">Secili filtrelerde prediction type performans kaydi yok.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-700">
      <table className="min-w-full divide-y divide-slate-700 text-sm">
        <thead className="bg-slate-950/70">
          <tr>
            <th className="px-3 py-2 text-left text-slate-300">Prediction Type</th>
            <th className="px-3 py-2 text-left text-slate-300">Sample</th>
            <th className="px-3 py-2 text-left text-slate-300">Accuracy</th>
            <th className="px-3 py-2 text-left text-slate-300">LogLoss</th>
            <th className="px-3 py-2 text-left text-slate-300">Brier</th>
            <th className="px-3 py-2 text-left text-slate-300">Avg Confidence</th>
            <th className="px-3 py-2 text-left text-slate-300">Calibration</th>
            <th className="px-3 py-2 text-left text-slate-300">Trend</th>
            <th className="px-3 py-2 text-left text-slate-300">Durum</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((row) => (
            <tr key={`${row.predictionType}-${row.line ?? "base"}`} className="bg-slate-900/30">
              <td className="px-3 py-2 text-slate-100">
                {typeLabel(row.predictionType)}
                {row.line !== null ? <span className="ml-2 text-xs text-slate-400">line {row.line.toFixed(1)}</span> : null}
              </td>
              <td className="px-3 py-2 text-slate-100">{row.sampleSize}</td>
              <td className="px-3 py-2 text-slate-100">{formatMetric(row.accuracy)}</td>
              <td className="px-3 py-2 text-slate-100">{formatMetric(row.logLoss)}</td>
              <td className="px-3 py-2 text-slate-100">{formatMetric(row.brierScore)}</td>
              <td className="px-3 py-2 text-slate-100">{formatPct(row.avgConfidenceScore)}</td>
              <td className="px-3 py-2 text-slate-100">{formatMetric(row.calibrationQuality)}</td>
              <td className="px-3 py-2 text-slate-100">{trendLabel(row.trendDirection)}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex rounded-md border px-2 py-1 text-xs ${statusTone(row.status)}`}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PredictionLinePerformanceTable({ rows }: { rows: PredictionTypePerformanceItem[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-slate-300">Line bazli performans verisi yok.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-md border border-slate-700">
      <table className="min-w-full divide-y divide-slate-700 text-sm">
        <thead className="bg-slate-950/70">
          <tr>
            <th className="px-3 py-2 text-left text-slate-300">Line</th>
            <th className="px-3 py-2 text-left text-slate-300">Hit Rate</th>
            <th className="px-3 py-2 text-left text-slate-300">Sample</th>
            <th className="px-3 py-2 text-left text-slate-300">Avg Confidence</th>
            <th className="px-3 py-2 text-left text-slate-300">Variance</th>
            <th className="px-3 py-2 text-left text-slate-300">Durum</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-800">
          {rows.map((row) => (
            <tr key={`line-${row.line ?? "none"}`} className="bg-slate-900/30">
              <td className="px-3 py-2 text-slate-100">{row.line !== null ? row.line.toFixed(1) : "-"}</td>
              <td className="px-3 py-2 text-slate-100">{formatMetric(row.accuracy)}</td>
              <td className="px-3 py-2 text-slate-100">{row.sampleSize}</td>
              <td className="px-3 py-2 text-slate-100">{formatPct(row.avgConfidenceScore)}</td>
              <td className="px-3 py-2 text-slate-100">{formatMetric(row.varianceScore)}</td>
              <td className="px-3 py-2">
                <span className={`inline-flex rounded-md border px-2 py-1 text-xs ${statusTone(row.status)}`}>{row.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function buildModelRows(performanceRows: PerformanceTimeseriesRow[], comparisons: ModelComparisonRow[]): ModelScoreRow[] {
  const grouped = new Map<string, PerformanceTimeseriesRow[]>();
  for (const row of performanceRows) {
    const rows = grouped.get(row.modelVersionId) ?? [];
    rows.push(row);
    grouped.set(row.modelVersionId, rows);
  }

  const winCounter = new Map<string, number>();
  for (const row of comparisons) {
    if (row.winnerModel && row.winnerModel.length >= 8) {
      const key = row.winnerModel.split(":")[0] === "elo_poisson" ? row.modelVersionId : row.modelVersionId;
      winCounter.set(key, (winCounter.get(key) ?? 0) + 1);
    }
  }

  return Array.from(grouped.entries())
    .map(([modelVersionId, rows]) => {
      const parsed = rows.map((row) => {
        const metrics = (row.metrics ?? {}) as Record<string, unknown>;
        return {
          accuracy: asNumber(metrics.accuracy),
          brierScore: asNumber(metrics.brier ?? metrics.brierScore),
          logLoss: asNumber(metrics.logLoss ?? metrics.log_loss)
        };
      });
      const accuracy = avg(parsed.map((item) => item.accuracy));
      const brierScore = avg(parsed.map((item) => item.brierScore));
      const logLoss = avg(parsed.map((item) => item.logLoss));
      const status = statusFromMetrics({
        sampleSize: rows.length,
        accuracy,
        calibrationQuality: accuracy !== null ? Math.max(0, 1 - Math.abs((accuracy ?? 0) - 0.55)) : null,
        varianceScore: brierScore
      });

      return {
        modelVersionId,
        sampleSize: rows.length,
        accuracy,
        brierScore,
        logLoss,
        winCount: winCounter.get(modelVersionId) ?? 0,
        status
      };
    })
    .sort((a, b) => (b.accuracy ?? 0) - (a.accuracy ?? 0));
}

export default async function PredictionPerformancePage({ searchParams }: PerformancePageProps) {
  const query = await searchParams;
  const filters = resolveFilters(query);

  const [performanceResult, lowConfidenceResult, failedResult, comparisonResult, byTypeResult, highVarianceResult] =
    await Promise.all([
      adminApiGet<PerformanceTimeseriesRow[]>("/api/v1/admin/models/performance-timeseries"),
      adminApiGet<LowConfidenceRow[]>("/api/v1/admin/predictions/low-confidence"),
      adminApiGet<FailedPredictionRow[]>("/api/v1/admin/predictions/failed"),
      adminApiGet<ModelComparisonRow[]>("/api/v1/admin/models/comparison"),
      adminApiGet<unknown[]>("/api/v1/admin/predictions/by-type"),
      adminApiGet<unknown[]>("/api/v1/admin/predictions/high-variance")
    ]);

  const performanceRows: PerformanceTimeseriesRow[] =
    performanceResult.ok && Array.isArray(performanceResult.data) ? (performanceResult.data as PerformanceTimeseriesRow[]) : [];
  const lowConfidenceRows: LowConfidenceRow[] =
    lowConfidenceResult.ok && Array.isArray(lowConfidenceResult.data) ? (lowConfidenceResult.data as LowConfidenceRow[]) : [];
  const failedRows: FailedPredictionRow[] =
    failedResult.ok && Array.isArray(failedResult.data) ? (failedResult.data as FailedPredictionRow[]) : [];
  const comparisonRows: ModelComparisonRow[] =
    comparisonResult.ok && Array.isArray(comparisonResult.data) ? (comparisonResult.data as ModelComparisonRow[]) : [];
  const byTypeRows: unknown[] = byTypeResult.ok && Array.isArray(byTypeResult.data) ? byTypeResult.data : [];
  const highVarianceRows: unknown[] =
    highVarianceResult.ok && Array.isArray(highVarianceResult.data) ? highVarianceResult.data : [];

  const modelOptions: string[] = Array.from(new Set(performanceRows.map((row: PerformanceTimeseriesRow) => row.modelVersionId))).sort();
  const filteredPerformanceRows =
    filters.modelVersion === "all"
      ? performanceRows
      : performanceRows.filter((row: PerformanceTimeseriesRow) => row.modelVersionId === filters.modelVersion);

  const allTypeRows = buildPredictionTypeRows({
    performanceRows: filteredPerformanceRows,
    lowConfidenceRows,
    failedRows,
    apiByTypeRows: byTypeRows
  });
  const filteredTypeRows = applyFilters(allTypeRows, filters);
  const lineRows = applyFilters(buildLineRows(allTypeRows), filters);

  const trendPoints = buildTrendPoints(filteredPerformanceRows);
  const trendAccuracy = trendPoints
    .map((point) => point.accuracy)
    .filter((item: number | null): item is number => item !== null)
    .slice(-16);
  const trendBrier = trendPoints
    .map((point) => point.brierScore)
    .filter((item: number | null): item is number => item !== null)
    .slice(-16);
  const trendLogLoss = trendPoints
    .map((point) => point.logLoss)
    .filter((item: number | null): item is number => item !== null)
    .slice(-16);

  const referenceAccuracy = avg(filteredTypeRows.map((row) => row.accuracy));
  const confidenceBuckets = buildConfidenceBuckets({
    lowConfidenceRows,
    referenceAccuracy
  });

  const varianceRowsFromSignals = buildVarianceRows({ lowConfidenceRows, failedRows });
  const varianceRows: PredictionVarianceItem[] =
    highVarianceRows.length > 0
      ? highVarianceRows.slice(0, 10).map((item: unknown, index: number) => ({
          key: `api-${index}`,
          label: String((item as Record<string, unknown>).predictionType ?? (item as Record<string, unknown>).issueCategory ?? "high_variance"),
          count: asNumber((item as Record<string, unknown>).count) ?? 1,
          severity: "watch",
          note: "Backend high-variance endpoint kaydi."
        }))
      : varianceRowsFromSignals;

  const summary = buildSummary(
    filteredTypeRows,
    varianceRows.reduce((sum: number, row: PredictionVarianceItem) => sum + row.count, 0)
  );
  const modelRows = buildModelRows(filteredPerformanceRows, comparisonRows);

  const anyError = [performanceResult, lowConfidenceResult, failedResult, comparisonResult].some((item) => !item.ok);
  const activeTypeLabel = typeLabel(filters.predictionType === "all" ? "fullTimeResult" : filters.predictionType);

  return (
    <div className="space-y-4">
      <SectionCard title="Prediction Type Performance" subtitle="Tahmin turu performans analizi">
        <div className="mb-3 rounded-md border border-cyan-900/50 bg-cyan-950/30 p-3 text-sm text-cyan-100">
          Bu ekran mevcut admin endpointlerinden uretilen performans gorunumudur. By-type endpoint hazir degilse veriler model
          seviyesi proxy metriklerle gosterilir.
        </div>

        {anyError ? (
          <p className="mb-3 rounded-md border border-amber-900/70 bg-amber-950/40 p-3 text-sm text-amber-200">
            Bazi endpoint verileri alinamadi. Ekran mevcut veriyle calismaya devam ediyor.
          </p>
        ) : null}

        <form method="get" className="grid gap-3 rounded-md border border-slate-700 bg-slate-900/40 p-3 lg:grid-cols-4">
          <label className="space-y-1 text-xs text-slate-300">
            Sport
            <select name="sport" defaultValue={filters.sport} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
              <option value="football">Football</option>
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-300">
            League
            <select name="league" defaultValue={filters.league} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
              <option value="all">Tum Ligler</option>
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-300">
            Prediction Type
            <select
              name="predictionType"
              defaultValue={filters.predictionType}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            >
              <option value="all">Tum Tipler</option>
              {Array.from(new Set(allTypeRows.map((row: PredictionTypePerformanceItem) => row.predictionType))).map(
                (type: string) => (
                <option key={type} value={type}>
                  {typeLabel(type)}
                </option>
                )
              )}
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-300">
            Model Version
            <select
              name="modelVersion"
              defaultValue={filters.modelVersion}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            >
              <option value="all">Tum Modeller</option>
              {modelOptions.map((model: string) => (
                <option key={model} value={model}>
                  {shortModel(model)}
                </option>
              ))}
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-300">
            Date From
            <input
              type="date"
              name="dateFrom"
              defaultValue={filters.dateFrom}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            />
          </label>

          <label className="space-y-1 text-xs text-slate-300">
            Date To
            <input
              type="date"
              name="dateTo"
              defaultValue={filters.dateTo}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            />
          </label>

          <label className="space-y-1 text-xs text-slate-300">
            Line
            <select name="line" defaultValue={filters.line} className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm">
              <option value="all">Tum Line</option>
              <option value="1.5">1.5</option>
              <option value="2.5">2.5</option>
              <option value="3.5">3.5</option>
            </select>
          </label>

          <label className="space-y-1 text-xs text-slate-300">
            Min Sample
            <input
              type="number"
              name="minSampleSize"
              min={0}
              defaultValue={filters.minSampleSize}
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm"
            />
          </label>

          <div className="flex items-end gap-2">
            <button type="submit" className="rounded border border-slate-600 px-3 py-1.5 text-sm text-slate-100 hover:bg-slate-800">
              Uygula
            </button>
            <a href="/admin/predictions/performance" className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800">
              Sifirla
            </a>
          </div>
        </form>

        <div className="mt-4 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <MetricChip label="Toplam Sample" value={summary.sampleSize} />
          <MetricChip label="En Iyi Type" value={typeLabel(summary.bestPredictionType)} />
          <MetricChip label="En Zayif Type" value={typeLabel(summary.weakestPredictionType)} />
          <MetricChip label="Avg Confidence" value={formatPct(summary.avgConfidence)} />
          <MetricChip label="Calibration Alignment" value={formatMetric(summary.calibrationAlignment)} />
          <MetricChip label="High Variance Count" value={summary.highVarianceMatchCount} />
        </div>
      </SectionCard>

      <SectionCard title="Prediction Type Performance" subtitle="Tahmin turu bazli tablo">
        <PredictionTypePerformanceTable rows={filteredTypeRows} />
      </SectionCard>

      <SectionCard title="Line-Based Performance" subtitle="Ozellikle totalGoalsOverUnder line gorunumu">
        <PredictionLinePerformanceTable rows={lineRows} />
      </SectionCard>

      <SectionCard title="Model Comparison By Type" subtitle="Secili prediction type icin model bazli kalite">
        <ModelComparisonByType rows={modelRows} currentTypeLabel={activeTypeLabel} />
      </SectionCard>

      <SectionCard title="Confidence vs Outcome (Proxy)" subtitle="Confidence bucket hizalama gorunumu">
        <div className="mb-3 text-xs text-slate-400">
          Outcome bucket endpointi hazir olmadigi icin basari oranlari mevcut model accuracy ve confidence dagilimindan proxy olarak
          hesaplanir.
        </div>
        <ConfidenceBucketChart buckets={confidenceBuckets} />
      </SectionCard>

      <SectionCard title="High Variance / Unstable Area" subtitle="Celiski ve oynaklik sinyalleri">
        <VarianceWarningPanel items={varianceRows} />
      </SectionCard>

      <SectionCard title="Prediction Type Trend" subtitle="Model performans trend cizgisi">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Accuracy Trend</p>
            {sparkline(trendAccuracy)}
          </div>
          <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">Brier Trend</p>
            {sparkline(trendBrier)}
          </div>
          <div className="rounded-md border border-slate-700 bg-slate-900/40 p-3">
            <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">LogLoss Trend</p>
            {sparkline(trendLogLoss)}
          </div>
        </div>
      </SectionCard>
    </div>
  );
}
