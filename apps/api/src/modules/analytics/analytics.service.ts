import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";

async function queryWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`query_timeout_${timeoutMs}`)), timeoutMs);
    })
  ]);
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  private toSafeNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.max(0, Math.floor(value));
    }
    if (typeof value === "bigint") {
      return Number(value > 0n ? value : 0n);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return 0;
    }
    return Math.max(0, Math.floor(parsed));
  }

  private async estimateTableCounts() {
    try {
      const rows = await this.prisma.$queryRawUnsafe<
        Array<{ matchCount: unknown; predictionCount: unknown; failedCount: unknown }>
      >(
        `
        SELECT
          GREATEST(COALESCE((SELECT reltuples FROM pg_class WHERE oid = to_regclass('"Match"')), 0), 0)::bigint AS "matchCount",
          GREATEST(COALESCE((SELECT reltuples FROM pg_class WHERE oid = to_regclass('"Prediction"')), 0), 0)::bigint AS "predictionCount",
          GREATEST(COALESCE((SELECT reltuples FROM pg_class WHERE oid = to_regclass('"FailedPredictionAnalysis"')), 0), 0)::bigint AS "failedCount"
      `
      );
      const row = rows?.[0];
      return {
        matchCount: this.toSafeNumber(row?.matchCount),
        predictionCount: this.toSafeNumber(row?.predictionCount),
        failedCount: this.toSafeNumber(row?.failedCount)
      };
    } catch {
      return {
        matchCount: 0,
        predictionCount: 0,
        failedCount: 0
      };
    }
  }

  private async estimateLowConfidenceCount(predictionCount: number) {
    try {
      const sample = await queryWithTimeout(
        this.prisma.prediction.findMany({
          select: { isLowConfidence: true },
          orderBy: { createdAt: "desc" },
          take: 1000
        }),
        1200
      );

      if (sample.length === 0) {
        return 0;
      }
      const lowSample = sample.reduce((acc, row) => acc + (row.isLowConfidence ? 1 : 0), 0);
      const ratio = lowSample / sample.length;
      return Math.max(0, Math.round(predictionCount * ratio));
    } catch {
      return 0;
    }
  }

  async dashboard() {
    const cacheKey = "analytics:dashboard:v2";
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const estimated = await this.estimateTableCounts();
      const [matchCountResult, predictionCountResult, lowConfidenceResult, failedCountResult] = await Promise.allSettled([
        queryWithTimeout(this.prisma.match.count(), 1400),
        queryWithTimeout(this.prisma.prediction.count(), 1400),
        queryWithTimeout(this.prisma.prediction.count({ where: { isLowConfidence: true } }), 1400),
        queryWithTimeout(this.prisma.failedPredictionAnalysis.count(), 1400)
      ]);

      const matchCount =
        matchCountResult.status === "fulfilled" ? matchCountResult.value : estimated.matchCount;
      const predictionCount =
        predictionCountResult.status === "fulfilled" ? predictionCountResult.value : estimated.predictionCount;
      const failedCount =
        failedCountResult.status === "fulfilled" ? failedCountResult.value : estimated.failedCount;

      const lowConfidenceCount =
        lowConfidenceResult.status === "fulfilled"
          ? lowConfidenceResult.value
          : await this.estimateLowConfidenceCount(predictionCount);

      const data = {
        matchCount,
        predictionCount,
        lowConfidenceCount,
        failedCount,
        generatedAt: new Date().toISOString()
      };

      await this.cache.set(cacheKey, data, 180, ["dashboard"]);
      return data;
    } catch {
      return {
        matchCount: 0,
        predictionCount: 0,
        lowConfidenceCount: 0,
        failedCount: 0,
        generatedAt: new Date().toISOString(),
        degraded: true
      };
    }
  }
}