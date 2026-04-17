import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { PolicyCandidateStatus, PolicyPromotionDecisionStatus, ResearchRunStatus, StrategyObjective, TuningSearchType } from "@prisma/client";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { ExperimentTrackingService } from "../research-lab/experiment-tracking.service";
import { PolicyCandidateRegistryService } from "../research-lab/policy-candidate-registry.service";
import { PolicyPromotionGateService } from "../research-lab/policy-promotion-gate.service";
import { ResearchLabConfigService } from "../research-lab/research-lab-config.service";
import { ResearchLabOrchestrationService } from "../research-lab/research-lab-orchestration.service";

@Controller("admin/research")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminResearchLabController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ResearchLabConfigService,
    private readonly trackingService: ExperimentTrackingService,
    private readonly orchestrationService: ResearchLabOrchestrationService,
    private readonly candidateRegistry: PolicyCandidateRegistryService,
    private readonly promotionGateService: PolicyPromotionGateService
  ) {}

  private toTake(value: string | undefined, fallback = 100) {
    if (!value) {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(1, Math.min(1000, Math.floor(parsed)));
  }

  @Patch("flags")
  async patchFlags(
    @Body()
    body: {
      researchLabEnabled?: boolean;
      autoTuningEnabled?: boolean;
      trialPruningEnabled?: boolean;
      policyCandidateRegistryEnabled?: boolean;
      policyShadowPromotionEnabled?: boolean;
      policyCanaryPromotionEnabled?: boolean;
    }
  ) {
    return this.configService.setSettings(body);
  }

  @Get("health")
  async health() {
    const [settings, runCount, candidateCount, pendingPromotions] = await Promise.all([
      this.configService.getSettings(),
      this.prisma.researchRun.count(),
      this.prisma.policyCandidate.count(),
      this.prisma.policyPromotionRequest.count({
        where: { status: "queued" }
      })
    ]);
    return {
      settings,
      queueName: this.orchestrationService.queueName(),
      stageCount: this.orchestrationService.stages().length,
      runCount,
      candidateCount,
      pendingPromotions
    };
  }

  @Post("projects")
  async createProject(@Body() body: { key: string; name: string; description?: string; sport?: string }) {
    return this.trackingService.createProject(body);
  }

  @Get("projects")
  async projects(@Query("take") take?: string, @Query("sport") sport?: string) {
    return this.prisma.researchProject.findMany({
      where: {
        ...(sport ? { sportCode: sport.trim().toLowerCase() } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200)
    });
  }

  @Post("experiments")
  async createExperiment(
    @Body()
    body: {
      projectId: string;
      key: string;
      name: string;
      description?: string;
      objective?: StrategyObjective;
      objectiveDefinition?: Record<string, unknown>;
      seed?: number;
      sport?: string;
      notes?: string;
    }
  ) {
    return this.trackingService.createExperiment(body);
  }

  @Get("experiments")
  async experiments(@Query("projectId") projectId?: string, @Query("take") take?: string) {
    return this.prisma.researchExperiment.findMany({
      where: {
        ...(projectId ? { projectId } : {})
      },
      include: {
        project: true
      },
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200)
    });
  }

  @Post("runs")
  async enqueueRun(
    @Body()
    body: {
      projectId: string;
      experimentId: string;
      rangeStart: string;
      rangeEnd: string;
      sport?: string;
      objectiveMetric?: string;
      secondaryMetrics?: string[];
      datasetHashes?: Record<string, unknown>;
      seed?: number;
      searchType?: TuningSearchType;
      maxTrials?: number;
      strategyConfig?: Record<string, unknown>;
      marketScope?: string[];
      horizonScope?: string[];
      leagueScope?: string[];
      notes?: string;
      tags?: string[];
    }
  ) {
    return this.orchestrationService.enqueueResearchFlow({
      projectId: body.projectId,
      experimentId: body.experimentId,
      rangeStart: new Date(body.rangeStart),
      rangeEnd: new Date(body.rangeEnd),
      sport: body.sport ?? "football",
      objectiveMetric: body.objectiveMetric ?? "roi",
      secondaryMetrics: body.secondaryMetrics ?? ["yield", "logLoss"],
      datasetHashes: body.datasetHashes ?? { source: "manual" },
      seed: Math.max(1, Math.floor(body.seed ?? 42)),
      searchType: body.searchType,
      maxTrials: body.maxTrials,
      actor: "admin",
      strategyConfig: body.strategyConfig ?? {},
      marketScope: body.marketScope ?? [],
      horizonScope: body.horizonScope ?? [],
      leagueScope: body.leagueScope ?? [],
      notes: body.notes,
      tags: body.tags ?? []
    });
  }

  @Get("runs")
  async runs(
    @Query("projectId") projectId?: string,
    @Query("experimentId") experimentId?: string,
    @Query("status") status?: ResearchRunStatus,
    @Query("take") take?: string
  ) {
    return this.prisma.researchRun.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(experimentId ? { experimentId } : {}),
        ...(status ? { status } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200),
      include: {
        project: true,
        experiment: true
      }
    });
  }

  @Get("runs/compare")
  async compareRuns(@Query("runIds") runIdsCsv?: string) {
    const runIds = (runIdsCsv ?? "")
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    return this.trackingService.compareRuns(runIds);
  }

  @Get("trials")
  async trials(@Query("runId") runId: string, @Query("take") take?: string) {
    return this.prisma.tuningTrial.findMany({
      where: { researchRunId: runId },
      orderBy: [{ trialNumber: "asc" }],
      take: this.toTake(take, 400),
      include: {
        metrics: true,
        artifacts: true
      }
    });
  }

  @Get("candidates")
  async candidates(@Query("status") status?: PolicyCandidateStatus, @Query("take") take?: string) {
    return this.prisma.policyCandidate.findMany({
      where: {
        ...(status ? { status } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200),
      include: {
        project: true,
        experiment: true,
        researchRun: true,
        bestTrial: true
      }
    });
  }

  @Post("candidates/:id/promotion-request")
  async createPromotionRequest(
    @Param("id") candidateId: string,
    @Body() body: { reason?: string; evidence?: Record<string, unknown> }
  ) {
    return this.candidateRegistry.createPromotionRequest({
      candidateId,
      requestedBy: "admin",
      reason: body.reason ?? null,
      evidence: body.evidence ?? null
    });
  }

  @Post("promotion-gate/evaluate")
  async evaluatePromotionGate(
    @Body()
    body: {
      requestId: string;
      candidateId: string;
      sampleSize: number;
      minimumSampleSize: number;
      robustnessScore: number;
      minimumRobustnessScore: number;
      hasOverfitFlag?: boolean;
      hasSegmentFailure?: boolean;
      auditComplete?: boolean;
      allowCanary?: boolean;
      force?: "APPROVE" | "REJECT" | null;
    }
  ) {
    return this.promotionGateService.evaluateAndPersist({
      requestId: body.requestId,
      candidateId: body.candidateId,
      actor: "admin",
      allowCanary: body.allowCanary ?? false,
      force: body.force ?? null,
      evaluation: {
        sampleSize: Math.max(0, Math.floor(body.sampleSize)),
        minimumSampleSize: Math.max(1, Math.floor(body.minimumSampleSize)),
        robustnessScore: body.robustnessScore,
        minimumRobustnessScore: body.minimumRobustnessScore,
        hasOverfitFlag: body.hasOverfitFlag ?? false,
        hasSegmentFailure: body.hasSegmentFailure ?? false,
        auditComplete: body.auditComplete ?? true
      }
    });
  }

  @Get("promotions")
  async promotions(
    @Query("status") status?: PolicyPromotionDecisionStatus,
    @Query("take") take?: string
  ) {
    return this.prisma.policyPromotionDecision.findMany({
      where: {
        ...(status ? { decisionStatus: status } : {})
      },
      orderBy: [{ createdAt: "desc" }],
      take: this.toTake(take, 200),
      include: {
        policyPromotionRequest: true,
        policyCandidate: true
      }
    });
  }
}
