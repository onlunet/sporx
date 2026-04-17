import { Body, Controller, Get, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { DriftSeverity, Prisma, PromotionDecisionStatus, RetrainingTriggerType, ServingAliasType } from "@prisma/client";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { ChallengerEvaluationService } from "../predictions/challenger-evaluation.service";
import { DriftMonitoringService } from "../predictions/drift-monitoring.service";
import { ModelAliasService } from "../predictions/model-alias.service";
import { ModelLifecycleOrchestrationService } from "../predictions/model-lifecycle-orchestration.service";
import { RetrainingTriggerService } from "../predictions/retraining-trigger.service";
import { RollbackDecisionService } from "../predictions/rollback-decision.service";

type ScopeInput = {
  sport: string;
  market: string;
  line?: number | null;
  horizon: string;
  leagueId?: string | null;
};

type ManualPromoteBody = ScopeInput & {
  modelVersionId: string;
  calibrationVersionId?: string | null;
  reason?: string | null;
};

type ManualRollbackBody = ScopeInput & {
  toModelVersionId: string;
  toCalibrationVersionId?: string | null;
  reason?: string | null;
};

type EnqueueLifecycleBody = ScopeInput & {
  windowStart?: string | null;
  windowEnd?: string | null;
};

@Controller("admin/models/lifecycle")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminModelLifecycleController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelAliasService: ModelAliasService,
    private readonly lifecycleOrchestration: ModelLifecycleOrchestrationService,
    private readonly rollbackDecisionService: RollbackDecisionService,
    private readonly driftMonitoringService: DriftMonitoringService,
    private readonly retrainingTriggerService: RetrainingTriggerService,
    private readonly challengerEvaluationService: ChallengerEvaluationService
  ) {}

  private toTake(value: string | undefined, fallback = 120) {
    if (!value) {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(1, Math.min(1000, Math.trunc(parsed)));
  }

  @Get("aliases")
  async aliases(
    @Query("sport") sport?: string,
    @Query("market") market?: string,
    @Query("horizon") horizon?: string,
    @Query("leagueId") leagueId?: string,
    @Query("aliasType") aliasType?: ServingAliasType,
    @Query("take") take?: string
  ) {
    return this.prisma.modelAlias.findMany({
      where: {
        ...(sport ? { sportCode: sport.trim().toLowerCase() } : {}),
        ...(market ? { market: market.trim().toLowerCase() } : {}),
        ...(horizon ? { horizon: horizon.trim().toUpperCase() } : {}),
        ...(leagueId ? { leagueId } : {}),
        ...(aliasType ? { aliasType } : {})
      },
      orderBy: [{ updatedAt: "desc" }],
      take: this.toTake(take, 200)
    });
  }

  @Get("alias-history")
  async aliasHistory(@Query("take") take?: string) {
    return this.prisma.servingAliasHistory.findMany({
      include: {
        modelAlias: true
      },
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 300)
    });
  }

  @Get("shadow-evaluations")
  async shadowEvaluations(
    @Query("sport") sport?: string,
    @Query("market") market?: string,
    @Query("horizon") horizon?: string,
    @Query("take") take?: string
  ) {
    return this.prisma.challengerEvaluation.findMany({
      where: {
        ...(sport ? { sportCode: sport.trim().toLowerCase() } : {}),
        ...(market ? { market: market.trim().toLowerCase() } : {}),
        ...(horizon ? { horizon: horizon.trim().toUpperCase() } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200)
    });
  }

  @Get("promotion-decisions")
  async promotionDecisions(@Query("take") take?: string) {
    return this.prisma.promotionDecision.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200)
    });
  }

  @Get("rollback-events")
  async rollbackEvents(@Query("take") take?: string) {
    return this.prisma.rollbackEvent.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200)
    });
  }

  @Get("drift-events")
  async driftEvents(@Query("take") take?: string) {
    return this.prisma.driftEvent.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200)
    });
  }

  @Get("retraining-triggers")
  async retrainingTriggers(@Query("take") take?: string) {
    return this.prisma.retrainingTrigger.findMany({
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200)
    });
  }

  @Get("health")
  async health() {
    const [aliasCount, shadowCount, promotionCount, rollbackCount, driftCount, triggerCount] = await Promise.all([
      this.prisma.modelAlias.count(),
      this.prisma.shadowEvalRun.count(),
      this.prisma.promotionDecision.count(),
      this.prisma.rollbackEvent.count(),
      this.prisma.driftEvent.count(),
      this.prisma.retrainingTrigger.count()
    ]);

    return {
      aliasCount,
      shadowCount,
      promotionCount,
      rollbackCount,
      driftCount,
      triggerCount
    };
  }

  @Patch("flags")
  async patchFlags(@Body() body: Partial<Record<string, boolean>>) {
    return this.modelAliasService.setLifecycleFlags({
      championAliasResolutionEnabled: typeof body.championAliasResolutionEnabled === "boolean" ? body.championAliasResolutionEnabled : undefined,
      challengerShadowEnabled: typeof body.challengerShadowEnabled === "boolean" ? body.challengerShadowEnabled : undefined,
      canaryEnabled: typeof body.canaryEnabled === "boolean" ? body.canaryEnabled : undefined,
      autoPromotionEnabled: typeof body.autoPromotionEnabled === "boolean" ? body.autoPromotionEnabled : undefined,
      autoRollbackEnabled: typeof body.autoRollbackEnabled === "boolean" ? body.autoRollbackEnabled : undefined,
      driftTriggeredRetrainingEnabled:
        typeof body.driftTriggeredRetrainingEnabled === "boolean" ? body.driftTriggeredRetrainingEnabled : undefined
    });
  }

  @Post("enqueue")
  async enqueue(@Body() body: EnqueueLifecycleBody) {
    const flow = await this.lifecycleOrchestration.enqueueLifecycleFlow(
      {
        sport: body.sport,
        market: body.market,
        line: body.line ?? null,
        horizon: body.horizon,
        leagueId: body.leagueId ?? null
      },
      {
        windowStart: body.windowStart ? new Date(body.windowStart) : undefined,
        windowEnd: body.windowEnd ? new Date(body.windowEnd) : undefined,
        actor: "admin"
      }
    );

    return {
      flowJobId: flow.job.id,
      queueName: flow.job.queueName
    };
  }

  @Post("manual-promote")
  async manualPromote(@Body() body: ManualPromoteBody) {
    const alias = await this.modelAliasService.switchAlias({
      sport: body.sport,
      market: body.market,
      line: body.line ?? null,
      horizon: body.horizon,
      leagueId: body.leagueId ?? null,
      aliasType: ServingAliasType.CHAMPION,
      modelVersionId: body.modelVersionId,
      calibrationVersionId: body.calibrationVersionId ?? null,
      actor: "admin",
      reason: body.reason ?? "manual_promote",
      effectiveAt: new Date()
    });

    await this.prisma.promotionDecision.create({
      data: {
        sportCode: body.sport.trim().toLowerCase(),
        market: body.market.trim().toLowerCase(),
        line: body.line ?? null,
        lineKey: this.modelAliasService.lineKey(body.line ?? null),
        horizon: body.horizon.trim().toUpperCase(),
        leagueId: body.leagueId ?? null,
        scopeLeagueKey: this.modelAliasService.scopeLeagueKey(body.leagueId ?? null),
        championModelVersionId: body.modelVersionId,
        challengerModelVersionId: body.modelVersionId,
        championCalibrationVersionId: body.calibrationVersionId ?? null,
        challengerCalibrationVersionId: body.calibrationVersionId ?? null,
        status: PromotionDecisionStatus.FORCE_PROMOTE,
        decisionReasons: {
          reasons: ["manual_promote"],
          note: body.reason ?? null
        } as Prisma.InputJsonValue,
        actor: "admin",
        minimumSampleSizeMet: true,
        effectiveAt: new Date()
      }
    });

    return alias;
  }

  @Post("manual-rollback")
  async manualRollback(@Body() body: ManualRollbackBody) {
    return this.rollbackDecisionService.rollbackChampion({
      sport: body.sport,
      market: body.market,
      line: body.line ?? null,
      horizon: body.horizon,
      leagueId: body.leagueId ?? null,
      toModelVersionId: body.toModelVersionId,
      toCalibrationVersionId: body.toCalibrationVersionId ?? null,
      actor: "admin",
      reason: body.reason ?? "manual_rollback",
      metadata: {
        source: "admin_endpoint"
      }
    });
  }

  @Post("run-unlabeled-drift")
  async runUnlabeledDrift(@Body() body: ScopeInput & { lookbackHours?: number }) {
    const drift = await this.driftMonitoringService.evaluatePublishRateDrift({
      sport: body.sport,
      market: body.market,
      line: body.line ?? null,
      horizon: body.horizon,
      leagueId: body.leagueId ?? null,
      lookbackHours: body.lookbackHours
    });

    if (drift.created && drift.severity === DriftSeverity.CRITICAL) {
      await this.retrainingTriggerService.createOrUpdate({
        triggerType: RetrainingTriggerType.DRIFT_THRESHOLD,
        sport: body.sport,
        market: body.market,
        line: body.line ?? null,
        horizon: body.horizon,
        leagueId: body.leagueId ?? null,
        reasonPayload: {
          monitor: "publish_rate",
          severity: drift.severity,
          delta: drift.delta,
          driftEventId: drift.driftEventId ?? null
        },
        sourceMetricSnapshot: {
          delta: drift.delta,
          lookbackHours: body.lookbackHours ?? 24
        },
        dedupKey: `drift:${body.sport}:${body.market}:${this.modelAliasService.lineKey(body.line ?? null)}:${body.horizon}:${this.modelAliasService.scopeLeagueKey(body.leagueId ?? null)}`
      });
    }

    return drift;
  }

  @Post("record-shadow-window")
  async recordShadowWindow(
    @Body()
    body: ScopeInput & {
      championModelVersionId: string;
      challengerModelVersionId: string;
      sampleSize: number;
      windowStart: string;
      windowEnd: string;
      metrics?: Record<string, unknown>;
    }
  ) {
    return this.challengerEvaluationService.recordShadowWindow({
      sport: body.sport,
      market: body.market,
      line: body.line ?? null,
      horizon: body.horizon,
      leagueId: body.leagueId ?? null,
      championModelVersionId: body.championModelVersionId,
      challengerModelVersionId: body.challengerModelVersionId,
      sampleSize: Math.max(0, Math.trunc(body.sampleSize)),
      windowStart: new Date(body.windowStart),
      windowEnd: new Date(body.windowEnd),
      metrics: body.metrics ?? {}
    });
  }
}
