export type TrendDirection = "up" | "down" | "flat";
export type PredictionTypeStatus = "strong" | "stable" | "watch" | "weak";

export type PredictionTypePerformanceItem = {
  predictionType: string;
  line: number | null;
  sampleSize: number;
  accuracy: number | null;
  logLoss: number | null;
  brierScore: number | null;
  avgConfidenceScore: number | null;
  calibrationQuality: number | null;
  varianceScore: number | null;
  trendDirection: TrendDirection;
  status: PredictionTypeStatus;
  updatedAt: string | null;
  source: "api" | "derived";
};

export type PredictionPerformanceSummary = {
  sampleSize: number;
  bestPredictionType: string;
  weakestPredictionType: string;
  avgConfidence: number | null;
  calibrationAlignment: number | null;
  highVarianceMatchCount: number;
};

export type ConfidenceBucketItem = {
  key: string;
  label: string;
  min: number;
  max: number;
  sampleSize: number;
  avgConfidenceScore: number | null;
  estimatedSuccessRate: number | null;
  calibrationGap: number | null;
  status: PredictionTypeStatus;
};

export type PredictionVarianceItem = {
  key: string;
  label: string;
  count: number;
  severity: PredictionTypeStatus;
  note: string;
};

export type PredictionTypeTrendPoint = {
  measuredAt: string;
  accuracy: number | null;
  brierScore: number | null;
  logLoss: number | null;
};

export type PerformanceTimeseriesRow = {
  id: string;
  modelVersionId: string;
  measuredAt: string;
  metrics: unknown;
};

export type ModelComparisonRow = {
  id: string;
  modelVersionId: string;
  winnerModel: string | null;
  details: unknown;
};

export type LowConfidenceRow = {
  id: string;
  confidenceScore: number | null;
  riskFlags: unknown;
  summary?: string | null;
  createdAt?: string | null;
};

export type FailedPredictionRow = {
  id: string;
  issueCategory: string;
  analysis: unknown;
  actionItems: unknown;
  createdAt?: string | null;
};

export type PredictionTypePerformanceFilters = {
  sport: string;
  league: string;
  predictionType: string;
  modelVersion: string;
  dateFrom: string;
  dateTo: string;
  line: string;
  minSampleSize: number;
};

type ParsedMetrics = {
  accuracy: number | null;
  brierScore: number | null;
  logLoss: number | null;
};

const DEFAULT_PREDICTION_TYPE = "fullTimeResult";
const CONFIDENCE_BUCKETS = [
  { key: "b1", label: "0-40", min: 0, max: 0.4 },
  { key: "b2", label: "41-55", min: 0.41, max: 0.55 },
  { key: "b3", label: "56-70", min: 0.56, max: 0.7 },
  { key: "b4", label: "71-85", min: 0.71, max: 0.85 },
  { key: "b5", label: "86-100", min: 0.86, max: 1 }
];

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function parseMetrics(metrics: unknown): ParsedMetrics {
  const record = asRecord(metrics);
  if (!record) {
    return {
      accuracy: null,
      brierScore: null,
      logLoss: null
    };
  }

  return {
    accuracy: asNumber(record.accuracy),
    brierScore: asNumber(record.brier ?? record.brierScore),
    logLoss: asNumber(record.logLoss ?? record.log_loss)
  };
}

function avg(values: Array<number | null>): number | null {
  const usable = values.filter((item): item is number => item !== null);
  if (usable.length === 0) {
    return null;
  }
  return usable.reduce((sum, item) => sum + item, 0) / usable.length;
}

function trendDirection(points: Array<number | null>): TrendDirection {
  const usable = points.filter((item): item is number => item !== null);
  if (usable.length < 2) {
    return "flat";
  }
  const first = usable[0];
  const last = usable[usable.length - 1];
  const delta = last - first;
  if (delta > 0.01) {
    return "up";
  }
  if (delta < -0.01) {
    return "down";
  }
  return "flat";
}

export function statusFromMetrics(input: {
  sampleSize: number;
  accuracy: number | null;
  calibrationQuality: number | null;
  varianceScore: number | null;
}): PredictionTypeStatus {
  const { sampleSize, accuracy, calibrationQuality, varianceScore } = input;
  if (sampleSize < 12) {
    return "watch";
  }
  if ((varianceScore ?? 0) > 0.65) {
    return "weak";
  }
  if ((accuracy ?? 0) >= 0.58 && (calibrationQuality ?? 0) >= 0.75 && (varianceScore ?? 0) < 0.35) {
    return "strong";
  }
  if ((accuracy ?? 0) >= 0.53) {
    return "stable";
  }
  return "watch";
}

function parseApiByTypeRow(raw: unknown): PredictionTypePerformanceItem | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const predictionType = String(record.predictionType ?? record.type ?? DEFAULT_PREDICTION_TYPE);
  const sampleSize = asNumber(record.sampleSize) ?? 0;
  const accuracy = asNumber(record.accuracy);
  const brierScore = asNumber(record.brierScore ?? record.brier);
  const logLoss = asNumber(record.logLoss ?? record.log_loss);
  const avgConfidenceScore = asNumber(record.avgConfidenceScore ?? record.confidenceScore);
  const calibrationQuality = asNumber(record.calibrationQuality);
  const varianceScore = asNumber(record.varianceScore);
  const trendRaw = String(record.trendDirection ?? "flat").toLowerCase();
  const trendDirectionValue: TrendDirection =
    trendRaw === "up" || trendRaw === "down" || trendRaw === "flat" ? trendRaw : "flat";
  const statusRaw = String(record.status ?? "watch").toLowerCase();
  const statusValue: PredictionTypeStatus =
    statusRaw === "strong" || statusRaw === "stable" || statusRaw === "watch" || statusRaw === "weak"
      ? statusRaw
      : statusFromMetrics({
          sampleSize,
          accuracy,
          calibrationQuality,
          varianceScore
        });

  return {
    predictionType,
    line: asNumber(record.line),
    sampleSize,
    accuracy,
    brierScore,
    logLoss,
    avgConfidenceScore,
    calibrationQuality,
    varianceScore,
    trendDirection: trendDirectionValue,
    status: statusValue,
    updatedAt: (record.updatedAt as string | null | undefined) ?? null,
    source: "api"
  };
}

export function buildPredictionTypeRows(params: {
  performanceRows: PerformanceTimeseriesRow[];
  lowConfidenceRows: LowConfidenceRow[];
  failedRows: FailedPredictionRow[];
  apiByTypeRows?: unknown[] | null;
}): PredictionTypePerformanceItem[] {
  const apiRows = (params.apiByTypeRows ?? [])
    .map((item) => parseApiByTypeRow(item))
    .filter((item): item is PredictionTypePerformanceItem => item !== null);

  if (apiRows.length > 0) {
    return apiRows;
  }

  const parsedSeries = params.performanceRows
    .map((row) => ({ row, parsed: parseMetrics(row.metrics) }))
    .sort((a, b) => new Date(a.row.measuredAt).getTime() - new Date(b.row.measuredAt).getTime());

  const accuracySeries = parsedSeries.map((item) => item.parsed.accuracy);
  const brierSeries = parsedSeries.map((item) => item.parsed.brierScore);
  const logLossSeries = parsedSeries.map((item) => item.parsed.logLoss);

  const sampleSize = parsedSeries.length;
  const accuracy = avg(accuracySeries);
  const brierScore = avg(brierSeries);
  const logLoss = avg(logLossSeries);
  const avgConfidenceScore = avg(params.lowConfidenceRows.map((item) => asNumber(item.confidenceScore)));
  const failedCount = params.failedRows.length;
  const varianceScore = sampleSize > 0 ? clamp((failedCount + params.lowConfidenceRows.length * 0.35) / (sampleSize + 4), 0, 1) : 0.5;
  const calibrationQuality =
    avgConfidenceScore !== null && accuracy !== null ? clamp(1 - Math.abs(avgConfidenceScore - accuracy), 0, 1) : null;

  const row: PredictionTypePerformanceItem = {
    predictionType: DEFAULT_PREDICTION_TYPE,
    line: null,
    sampleSize,
    accuracy,
    brierScore,
    logLoss,
    avgConfidenceScore,
    calibrationQuality,
    varianceScore,
    trendDirection: trendDirection(accuracySeries),
    status: statusFromMetrics({
      sampleSize,
      accuracy,
      calibrationQuality,
      varianceScore
    }),
    updatedAt: parsedSeries[parsedSeries.length - 1]?.row.measuredAt ?? null,
    source: "derived"
  };

  return [row];
}

export function buildLineRows(rows: PredictionTypePerformanceItem[]): PredictionTypePerformanceItem[] {
  const fromApi = rows.filter((item) => item.line !== null);
  if (fromApi.length > 0) {
    return fromApi.sort((a, b) => (a.line ?? 99) - (b.line ?? 99));
  }

  return [1.5, 2.5, 3.5].map((line) => ({
    predictionType: "totalGoalsOverUnder",
    line,
    sampleSize: 0,
    accuracy: null,
    brierScore: null,
    logLoss: null,
    avgConfidenceScore: null,
    calibrationQuality: null,
    varianceScore: null,
    trendDirection: "flat",
    status: "watch",
    updatedAt: null,
    source: "derived"
  }));
}

export function buildSummary(rows: PredictionTypePerformanceItem[], highVarianceCount: number): PredictionPerformanceSummary {
  const sortedByScore = rows
    .slice()
    .sort((a, b) => {
      const scoreA = (a.accuracy ?? 0) - (a.brierScore ?? 0) * 0.3 - (a.varianceScore ?? 0) * 0.2;
      const scoreB = (b.accuracy ?? 0) - (b.brierScore ?? 0) * 0.3 - (b.varianceScore ?? 0) * 0.2;
      return scoreB - scoreA;
    });

  const sampleSize = rows.reduce((sum, row) => sum + row.sampleSize, 0);
  const avgConfidence = avg(rows.map((row) => row.avgConfidenceScore));
  const calibrationAlignment = avg(rows.map((row) => row.calibrationQuality));

  return {
    sampleSize,
    bestPredictionType: sortedByScore[0]?.predictionType ?? "-",
    weakestPredictionType: sortedByScore[sortedByScore.length - 1]?.predictionType ?? "-",
    avgConfidence,
    calibrationAlignment,
    highVarianceMatchCount: highVarianceCount
  };
}

export function buildConfidenceBuckets(params: {
  lowConfidenceRows: LowConfidenceRow[];
  referenceAccuracy: number | null;
}): ConfidenceBucketItem[] {
  return CONFIDENCE_BUCKETS.map((bucket) => {
    const inBucket = params.lowConfidenceRows.filter((row) => {
      const score = asNumber(row.confidenceScore);
      if (score === null) {
        return false;
      }
      return score >= bucket.min && score <= bucket.max;
    });
    const avgConfidenceScore = avg(inBucket.map((row) => asNumber(row.confidenceScore)));
    const estimatedSuccessRate =
      params.referenceAccuracy !== null && avgConfidenceScore !== null
        ? clamp(params.referenceAccuracy * (0.78 + avgConfidenceScore * 0.45), 0, 1)
        : null;
    const calibrationGap =
      estimatedSuccessRate !== null && avgConfidenceScore !== null
        ? Math.abs(estimatedSuccessRate - avgConfidenceScore)
        : null;

    const status = statusFromMetrics({
      sampleSize: inBucket.length,
      accuracy: estimatedSuccessRate,
      calibrationQuality: calibrationGap !== null ? 1 - calibrationGap : null,
      varianceScore: calibrationGap
    });

    return {
      key: bucket.key,
      label: bucket.label,
      min: bucket.min,
      max: bucket.max,
      sampleSize: inBucket.length,
      avgConfidenceScore,
      estimatedSuccessRate,
      calibrationGap,
      status
    };
  });
}

function countRiskByCode(rows: LowConfidenceRow[]) {
  const counter = new Map<string, number>();
  for (const row of rows) {
    const riskFlags = Array.isArray(row.riskFlags) ? row.riskFlags : [];
    for (const risk of riskFlags) {
      const record = asRecord(risk);
      const code = String(record?.code ?? "UNKNOWN");
      counter.set(code, (counter.get(code) ?? 0) + 1);
    }
  }
  return counter;
}

export function buildVarianceRows(params: {
  lowConfidenceRows: LowConfidenceRow[];
  failedRows: FailedPredictionRow[];
}): PredictionVarianceItem[] {
  const riskCounter = countRiskByCode(params.lowConfidenceRows);
  const failedByIssue = new Map<string, number>();
  for (const row of params.failedRows) {
    const issue = row.issueCategory || "unknown";
    failedByIssue.set(issue, (failedByIssue.get(issue) ?? 0) + 1);
  }

  const items: PredictionVarianceItem[] = [];
  for (const [code, count] of riskCounter.entries()) {
    items.push({
      key: `risk:${code}`,
      label: code,
      count,
      severity: count >= 8 ? "weak" : count >= 4 ? "watch" : "stable",
      note: "Düşük güven tahminlerinde tekrar eden risk kodu."
    });
  }
  for (const [issue, count] of failedByIssue.entries()) {
    items.push({
      key: `issue:${issue}`,
      label: issue,
      count,
      severity: count >= 5 ? "weak" : count >= 2 ? "watch" : "stable",
      note: "Başarısız tahmin analizinde öne çıkan sorun kategorisi."
    });
  }

  return items.sort((a, b) => b.count - a.count).slice(0, 10);
}

export function normalizeDateInput(value: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 10);
}

export function resolveFilters(searchParams: {
  sport?: string;
  league?: string;
  predictionType?: string;
  modelVersion?: string;
  dateFrom?: string;
  dateTo?: string;
  line?: string;
  minSampleSize?: string;
}): PredictionTypePerformanceFilters {
  const minSampleSizeRaw = Number(searchParams.minSampleSize ?? "0");
  return {
    sport: searchParams.sport ?? "football",
    league: searchParams.league ?? "all",
    predictionType: searchParams.predictionType ?? "all",
    modelVersion: searchParams.modelVersion ?? "all",
    dateFrom: normalizeDateInput(searchParams.dateFrom ?? ""),
    dateTo: normalizeDateInput(searchParams.dateTo ?? ""),
    line: searchParams.line ?? "all",
    minSampleSize: Number.isFinite(minSampleSizeRaw) ? Math.max(0, minSampleSizeRaw) : 0
  };
}

export function applyFilters(
  rows: PredictionTypePerformanceItem[],
  filters: PredictionTypePerformanceFilters
): PredictionTypePerformanceItem[] {
  return rows.filter((row) => {
    if (filters.predictionType !== "all" && row.predictionType !== filters.predictionType) {
      return false;
    }
    if (filters.line !== "all") {
      const lineNumber = Number(filters.line);
      if (!Number.isFinite(lineNumber) || row.line === null || row.line !== lineNumber) {
        return false;
      }
    }
    if (row.sampleSize < filters.minSampleSize) {
      return false;
    }
    if (filters.dateFrom && row.updatedAt) {
      if (new Date(row.updatedAt).getTime() < new Date(filters.dateFrom).getTime()) {
        return false;
      }
    }
    if (filters.dateTo && row.updatedAt) {
      const maxDate = new Date(`${filters.dateTo}T23:59:59.999Z`);
      if (new Date(row.updatedAt).getTime() > maxDate.getTime()) {
        return false;
      }
    }
    return true;
  });
}

export function buildTrendPoints(rows: PerformanceTimeseriesRow[]): PredictionTypeTrendPoint[] {
  return rows
    .slice()
    .sort((a, b) => new Date(a.measuredAt).getTime() - new Date(b.measuredAt).getTime())
    .map((row) => {
      const parsed = parseMetrics(row.metrics);
      return {
        measuredAt: row.measuredAt,
        accuracy: parsed.accuracy,
        brierScore: parsed.brierScore,
        logLoss: parsed.logLoss
      };
    });
}

