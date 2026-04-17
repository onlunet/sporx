import { Injectable } from "@nestjs/common";

export type SegmentMetricRow = {
  segmentType: string;
  segmentKey: string;
  turnover: number;
  roi: number;
  yield: number;
  hitRate: number;
  logLoss: number;
  brierScore: number;
  publishRate: number;
  abstainRate: number;
  averageStakeFraction: number;
  maxDrawdown: number;
  longestLosingStreak: number;
  fallbackRate: number;
  limitBreachRate: number;
};

type Aggregate = {
  count: number;
  sums: Record<string, number>;
  maxDrawdown: number;
  longestLosingStreak: number;
};

@Injectable()
export class SegmentScorecardService {
  private metricKeys(): Array<keyof SegmentMetricRow> {
    return [
      "turnover",
      "roi",
      "yield",
      "hitRate",
      "logLoss",
      "brierScore",
      "publishRate",
      "abstainRate",
      "averageStakeFraction",
      "fallbackRate",
      "limitBreachRate"
    ];
  }

  buildScorecards(rows: SegmentMetricRow[]) {
    const groups = new Map<string, Aggregate>();
    for (const row of rows) {
      const key = `${row.segmentType}::${row.segmentKey}`;
      const current = groups.get(key) ?? {
        count: 0,
        sums: {},
        maxDrawdown: 0,
        longestLosingStreak: 0
      };
      current.count += 1;
      for (const metricKey of this.metricKeys()) {
        const value = Number(row[metricKey]) || 0;
        current.sums[String(metricKey)] = (current.sums[String(metricKey)] ?? 0) + value;
      }
      current.maxDrawdown = Math.max(current.maxDrawdown, Number(row.maxDrawdown) || 0);
      current.longestLosingStreak = Math.max(current.longestLosingStreak, Number(row.longestLosingStreak) || 0);
      groups.set(key, current);
    }

    return Array.from(groups.entries()).map(([key, aggregate]) => {
      const [segmentType, segmentKey] = key.split("::");
      const metrics: Record<string, number> = {};
      for (const metricKey of this.metricKeys()) {
        metrics[String(metricKey)] = Number(((aggregate.sums[String(metricKey)] ?? 0) / aggregate.count).toFixed(6));
      }
      metrics.maxDrawdown = Number(aggregate.maxDrawdown.toFixed(6));
      metrics.longestLosingStreak = aggregate.longestLosingStreak;
      metrics.sampleSize = aggregate.count;

      return {
        segmentType,
        segmentKey,
        metrics
      };
    });
  }
}
