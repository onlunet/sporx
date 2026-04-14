import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  async dashboard() {
    const cacheKey = "analytics:dashboard:v1";
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) {
      return cached;
    }
    try {
      const [matchCount, predictionCount, lowConfidenceCount, failedCount] = await Promise.all([
        this.prisma.match.count(),
        this.prisma.prediction.count(),
        this.prisma.prediction.count({ where: { isLowConfidence: true } }),
        this.prisma.failedPredictionAnalysis.count()
      ]);

      const data = {
        matchCount,
        predictionCount,
        lowConfidenceCount,
        failedCount,
        generatedAt: new Date().toISOString()
      };

      await this.cache.set(cacheKey, data, 60, ["dashboard"]);
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
