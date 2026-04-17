import { Injectable } from "@nestjs/common";
import { DriftMonitorCategory, DriftSeverity, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { DriftComputationInput, DriftComputationResult } from "./model-lifecycle.types";
import { ModelAliasService } from "./model-alias.service";

export type DriftScopeInput = {
  sport: string;
  market: string;
  line?: number | null;
  horizon: string;
  leagueId?: string | null;
};

@Injectable()
export class DriftMonitoringService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelAliasService: ModelAliasService
  ) {}

  compute(input: DriftComputationInput): DriftComputationResult {
    const delta = input.current - input.baseline;
    const absDelta = Math.abs(delta);
    if (absDelta >= input.criticalThreshold) {
      return { severity: DriftSeverity.CRITICAL, delta };
    }
    if (absDelta >= input.warningThreshold) {
      return { severity: DriftSeverity.WARNING, delta };
    }
    return { severity: null, delta };
  }

  async upsertMonitor(input: DriftScopeInput & {
    monitorName: string;
    category: DriftMonitorCategory;
    warningThreshold: number;
    criticalThreshold: number;
    baseline?: Record<string, unknown> | null;
    config?: Record<string, unknown> | null;
  }) {
    const sport = input.sport.trim().toLowerCase();
    const market = input.market.trim().toLowerCase();
    const horizon = input.horizon.trim().toUpperCase();
    const line = input.line ?? null;
    const lineKey = this.modelAliasService.lineKey(line);
    const scopeLeagueKey = this.modelAliasService.scopeLeagueKey(input.leagueId ?? null);

    return this.prisma.driftMonitor.upsert({
      where: {
        sportCode_market_lineKey_horizon_scopeLeagueKey_monitorName: {
          sportCode: sport,
          market,
          lineKey,
          horizon,
          scopeLeagueKey,
          monitorName: input.monitorName
        }
      },
      update: {
        line,
        leagueId: input.leagueId ?? null,
        category: input.category,
        thresholdWarning: input.warningThreshold,
        thresholdCritical: input.criticalThreshold,
        baselineJson: (input.baseline ?? null) as Prisma.InputJsonValue,
        configJson: (input.config ?? null) as Prisma.InputJsonValue,
        isActive: true
      },
      create: {
        sportCode: sport,
        market,
        line,
        lineKey,
        horizon,
        leagueId: input.leagueId ?? null,
        scopeLeagueKey,
        monitorName: input.monitorName,
        category: input.category,
        thresholdWarning: input.warningThreshold,
        thresholdCritical: input.criticalThreshold,
        baselineJson: (input.baseline ?? null) as Prisma.InputJsonValue,
        configJson: (input.config ?? null) as Prisma.InputJsonValue,
        isActive: true
      }
    });
  }

  async evaluateAndLog(input: DriftScopeInput & {
    monitorName: string;
    metricName: string;
    baselineValue: number;
    currentValue: number;
    warningThreshold: number;
    criticalThreshold: number;
    category: DriftMonitorCategory;
    windowStart: Date;
    windowEnd: Date;
    details?: Record<string, unknown> | null;
  }) {
    const monitor = await this.upsertMonitor({
      ...input,
      baseline: { value: input.baselineValue },
      config: {
        metricName: input.metricName
      }
    });

    const computation = this.compute({
      baseline: input.baselineValue,
      current: input.currentValue,
      warningThreshold: input.warningThreshold,
      criticalThreshold: input.criticalThreshold
    });

    if (!computation.severity) {
      return {
        monitorId: monitor.id,
        created: false,
        severity: null as DriftSeverity | null,
        delta: computation.delta
      };
    }

    const driftEvent = await this.prisma.driftEvent.create({
      data: {
        driftMonitorId: monitor.id,
        sportCode: monitor.sportCode,
        market: monitor.market,
        line: monitor.line,
        lineKey: monitor.lineKey,
        horizon: monitor.horizon,
        leagueId: monitor.leagueId,
        scopeLeagueKey: monitor.scopeLeagueKey,
        severity: computation.severity,
        metricName: input.metricName,
        metricValue: input.currentValue,
        baselineValue: input.baselineValue,
        thresholdValue:
          computation.severity === DriftSeverity.CRITICAL ? input.criticalThreshold : input.warningThreshold,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        detailsJson: {
          delta: computation.delta,
          monitorName: input.monitorName,
          ...(input.details ?? {})
        } as Prisma.InputJsonValue
      }
    });

    return {
      monitorId: monitor.id,
      created: true,
      severity: driftEvent.severity,
      delta: computation.delta,
      driftEventId: driftEvent.id
    };
  }

  async evaluatePublishRateDrift(input: DriftScopeInput & { lookbackHours?: number }) {
    const lookbackHours = Math.max(1, Math.min(24 * 30, Math.floor(input.lookbackHours ?? 24)));
    const windowEnd = new Date();
    const windowStart = new Date(windowEnd.getTime() - lookbackHours * 60 * 60 * 1000);

    const where: Prisma.PublishDecisionWhereInput = {
      createdAt: { gte: windowStart, lte: windowEnd },
      market: input.market.trim().toLowerCase(),
      horizon: input.horizon.trim().toUpperCase()
    };
    if (input.leagueId) {
      where.match = { leagueId: input.leagueId };
    }

    const [total, approved] = await Promise.all([
      this.prisma.publishDecision.count({ where }),
      this.prisma.publishDecision.count({
        where: {
          ...where,
          status: { in: ["APPROVED", "MANUALLY_FORCED"] }
        }
      })
    ]);
    const publishRate = total === 0 ? 0 : approved / total;

    return this.evaluateAndLog({
      ...input,
      monitorName: "publish_rate",
      metricName: "publish_rate",
      baselineValue: 0.62,
      currentValue: publishRate,
      warningThreshold: 0.18,
      criticalThreshold: 0.26,
      category: DriftMonitorCategory.UNLABELED,
      windowStart,
      windowEnd,
      details: {
        total,
        approved
      }
    });
  }
}
