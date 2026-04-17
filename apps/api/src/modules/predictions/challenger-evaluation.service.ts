import { Injectable } from "@nestjs/common";
import { LifecycleRunStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelAliasService } from "./model-alias.service";

export type ShadowEvaluationWindowInput = {
  sport: string;
  market: string;
  line?: number | null;
  horizon: string;
  leagueId?: string | null;
  championModelVersionId: string;
  challengerModelVersionId: string;
  windowStart: Date;
  windowEnd: Date;
  sampleSize: number;
  metrics: Record<string, unknown>;
  coverage?: Record<string, unknown> | null;
  latency?: Record<string, unknown> | null;
  fallbackRate?: number | null;
};

@Injectable()
export class ChallengerEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelAliasService: ModelAliasService
  ) {}

  private dedupKey(input: ShadowEvaluationWindowInput) {
    return [
      input.sport.trim().toLowerCase(),
      input.market.trim().toLowerCase(),
      this.modelAliasService.lineKey(input.line ?? null),
      input.horizon.trim().toUpperCase(),
      this.modelAliasService.scopeLeagueKey(input.leagueId ?? null),
      input.championModelVersionId,
      input.challengerModelVersionId,
      input.windowStart.toISOString(),
      input.windowEnd.toISOString()
    ].join(":");
  }

  async recordShadowWindow(input: ShadowEvaluationWindowInput) {
    const dedupKey = this.dedupKey(input);
    const sport = input.sport.trim().toLowerCase();
    const market = input.market.trim().toLowerCase();
    const line = input.line ?? null;
    const lineKey = this.modelAliasService.lineKey(line);
    const horizon = input.horizon.trim().toUpperCase();
    const scopeLeagueKey = this.modelAliasService.scopeLeagueKey(input.leagueId ?? null);

    const shadowRun = await this.prisma.shadowEvalRun.upsert({
      where: { dedupKey },
      update: {
        sampleSize: input.sampleSize,
        status: LifecycleRunStatus.succeeded,
        metricsJson: input.metrics as Prisma.InputJsonValue,
        coverageJson: (input.coverage ?? null) as Prisma.InputJsonValue,
        latencyJson: (input.latency ?? null) as Prisma.InputJsonValue,
        fallbackRate: input.fallbackRate ?? null,
        completedAt: new Date()
      },
      create: {
        sportCode: sport,
        market,
        line,
        lineKey,
        horizon,
        leagueId: input.leagueId ?? null,
        scopeLeagueKey,
        championModelVersionId: input.championModelVersionId,
        challengerModelVersionId: input.challengerModelVersionId,
        evaluationWindowStart: input.windowStart,
        evaluationWindowEnd: input.windowEnd,
        sampleSize: input.sampleSize,
        status: LifecycleRunStatus.succeeded,
        metricsJson: input.metrics as Prisma.InputJsonValue,
        coverageJson: (input.coverage ?? null) as Prisma.InputJsonValue,
        latencyJson: (input.latency ?? null) as Prisma.InputJsonValue,
        fallbackRate: input.fallbackRate ?? null,
        dedupKey,
        completedAt: new Date()
      }
    });

    const challengerEvaluation = await this.prisma.challengerEvaluation.create({
      data: {
        sportCode: sport,
        market,
        line,
        lineKey,
        horizon,
        leagueId: input.leagueId ?? null,
        scopeLeagueKey,
        championModelVersionId: input.championModelVersionId,
        challengerModelVersionId: input.challengerModelVersionId,
        shadowEvalRunId: shadowRun.id,
        evaluationWindowStart: input.windowStart,
        evaluationWindowEnd: input.windowEnd,
        sampleSize: input.sampleSize,
        metricsJson: input.metrics as Prisma.InputJsonValue,
        segmentMetricsJson: {
          coverage: input.coverage ?? null
        } as Prisma.InputJsonValue,
        status: "shadow_completed"
      }
    });

    return {
      shadowRun,
      challengerEvaluation
    };
  }
}
