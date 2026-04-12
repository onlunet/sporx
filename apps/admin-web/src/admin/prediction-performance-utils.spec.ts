import { describe, expect, it } from "vitest";
import {
  resolveFilters,
  applyFilters,
  statusFromMetrics,
  buildLineRows,
  buildPredictionTypeRows,
  buildConfidenceBuckets,
  buildVarianceRows
} from "./prediction-performance-utils";

describe("prediction-performance-utils", () => {
  it("resolves query filters with defaults", () => {
    const filters = resolveFilters({});
    expect(filters.sport).toBe("football");
    expect(filters.predictionType).toBe("all");
    expect(filters.minSampleSize).toBe(0);
  });

  it("applies prediction type and line filters", () => {
    const rows = [
      {
        predictionType: "fullTimeResult",
        line: null,
        sampleSize: 20,
        accuracy: 0.55,
        logLoss: 0.62,
        brierScore: 0.2,
        avgConfidenceScore: 0.57,
        calibrationQuality: 0.88,
        varianceScore: 0.32,
        trendDirection: "up" as const,
        status: "stable" as const,
        updatedAt: "2026-04-11T00:00:00.000Z",
        source: "derived" as const
      },
      {
        predictionType: "totalGoalsOverUnder",
        line: 2.5,
        sampleSize: 16,
        accuracy: 0.53,
        logLoss: 0.64,
        brierScore: 0.21,
        avgConfidenceScore: 0.56,
        calibrationQuality: 0.82,
        varianceScore: 0.4,
        trendDirection: "flat" as const,
        status: "watch" as const,
        updatedAt: "2026-04-11T00:00:00.000Z",
        source: "derived" as const
      }
    ];

    const filters = resolveFilters({
      predictionType: "totalGoalsOverUnder",
      line: "2.5",
      minSampleSize: "10"
    });

    const filtered = applyFilters(rows, filters);
    expect(filtered.length).toBe(1);
    expect(filtered[0].predictionType).toBe("totalGoalsOverUnder");
    expect(filtered[0].line).toBe(2.5);
  });

  it("derives status from metrics", () => {
    expect(
      statusFromMetrics({
        sampleSize: 24,
        accuracy: 0.61,
        calibrationQuality: 0.82,
        varianceScore: 0.22
      })
    ).toBe("strong");

    expect(
      statusFromMetrics({
        sampleSize: 6,
        accuracy: 0.59,
        calibrationQuality: 0.9,
        varianceScore: 0.2
      })
    ).toBe("watch");

    expect(
      statusFromMetrics({
        sampleSize: 20,
        accuracy: 0.51,
        calibrationQuality: 0.6,
        varianceScore: 0.72
      })
    ).toBe("weak");
  });

  it("builds fallback line rows when api line data is missing", () => {
    const rows = buildLineRows([
      {
        predictionType: "fullTimeResult",
        line: null,
        sampleSize: 12,
        accuracy: 0.54,
        logLoss: 0.63,
        brierScore: 0.2,
        avgConfidenceScore: 0.56,
        calibrationQuality: 0.85,
        varianceScore: 0.33,
        trendDirection: "flat",
        status: "stable",
        updatedAt: null,
        source: "derived"
      }
    ]);
    expect(rows.map((item) => item.line)).toEqual([1.5, 2.5, 3.5]);
  });

  it("builds derived prediction type row when by-type endpoint is absent", () => {
    const rows = buildPredictionTypeRows({
      performanceRows: [
        {
          id: "a",
          modelVersionId: "m1",
          measuredAt: "2026-04-10T00:00:00.000Z",
          metrics: { accuracy: 0.54, brier: 0.2, logLoss: 0.62 }
        }
      ],
      lowConfidenceRows: [{ id: "x", confidenceScore: 0.5, riskFlags: [] }],
      failedRows: [],
      apiByTypeRows: []
    });
    expect(rows.length).toBe(1);
    expect(rows[0].predictionType).toBe("fullTimeResult");
  });

  it("builds confidence buckets and variance rows safely", () => {
    const buckets = buildConfidenceBuckets({
      lowConfidenceRows: [
        { id: "1", confidenceScore: 0.38, riskFlags: [{ code: "LOW_CONFIDENCE" }] },
        { id: "2", confidenceScore: 0.53, riskFlags: [{ code: "MEDIUM_VARIANCE" }] }
      ],
      referenceAccuracy: 0.55
    });
    expect(buckets.length).toBe(5);
    expect(buckets.some((bucket) => bucket.sampleSize > 0)).toBe(true);

    const variance = buildVarianceRows({
      lowConfidenceRows: [
        { id: "1", confidenceScore: 0.38, riskFlags: [{ code: "LOW_CONFIDENCE" }] },
        { id: "2", confidenceScore: 0.53, riskFlags: [{ code: "MEDIUM_VARIANCE" }] }
      ],
      failedRows: [{ id: "f1", issueCategory: "lineup_shock", analysis: {}, actionItems: {} }]
    });
    expect(variance.length).toBeGreaterThan(0);
  });
});

