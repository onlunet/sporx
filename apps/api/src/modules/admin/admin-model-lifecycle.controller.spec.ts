import { PromotionDecisionStatus, ServingAliasType } from "@prisma/client";
import { AdminModelLifecycleController } from "./admin-model-lifecycle.controller";

describe("AdminModelLifecycleController", () => {
  const prisma = {
    modelAlias: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    servingAliasHistory: { findMany: jest.fn() },
    challengerEvaluation: { findMany: jest.fn() },
    promotionDecision: {
      findMany: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: "promotion-1" })
    },
    rollbackEvent: { findMany: jest.fn() },
    driftEvent: { findMany: jest.fn() },
    retrainingTrigger: { findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
    shadowEvalRun: { count: jest.fn().mockResolvedValue(0) }
  } as any;

  const modelAliasService = {
    setLifecycleFlags: jest.fn().mockResolvedValue({}),
    lineKey: jest.fn().mockReturnValue("na"),
    scopeLeagueKey: jest.fn().mockReturnValue("global"),
    switchAlias: jest.fn().mockResolvedValue({ id: "alias-1", aliasType: ServingAliasType.CHAMPION })
  } as any;

  const lifecycleOrchestration = {
    enqueueLifecycleFlow: jest.fn().mockResolvedValue({
      job: {
        id: "job-1",
        queueName: "model-lifecycle"
      }
    })
  } as any;

  const rollbackDecisionService = {
    rollbackChampion: jest.fn().mockResolvedValue({ rollbackEvent: { id: "rollback-1" } })
  } as any;

  const driftMonitoringService = {
    evaluatePublishRateDrift: jest.fn().mockResolvedValue({ created: false, severity: null, delta: 0 })
  } as any;

  const retrainingTriggerService = {
    createOrUpdate: jest.fn().mockResolvedValue({ id: "trigger-1" })
  } as any;

  const challengerEvaluationService = {
    recordShadowWindow: jest.fn().mockResolvedValue({})
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("audits manual promote action", async () => {
    const controller = new AdminModelLifecycleController(
      prisma,
      modelAliasService,
      lifecycleOrchestration,
      rollbackDecisionService,
      driftMonitoringService,
      retrainingTriggerService,
      challengerEvaluationService
    );

    await controller.manualPromote({
      sport: "football",
      market: "match_outcome",
      line: null,
      horizon: "POST_MATCH",
      leagueId: null,
      modelVersionId: "model-2",
      calibrationVersionId: null,
      reason: "manual"
    });

    expect(modelAliasService.switchAlias).toHaveBeenCalledWith(
      expect.objectContaining({
        aliasType: ServingAliasType.CHAMPION,
        modelVersionId: "model-2"
      })
    );
    expect(prisma.promotionDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: PromotionDecisionStatus.FORCE_PROMOTE
        })
      })
    );
  });

  it("delegates manual rollback to rollback service", async () => {
    const controller = new AdminModelLifecycleController(
      prisma,
      modelAliasService,
      lifecycleOrchestration,
      rollbackDecisionService,
      driftMonitoringService,
      retrainingTriggerService,
      challengerEvaluationService
    );

    await controller.manualRollback({
      sport: "football",
      market: "match_outcome",
      line: null,
      horizon: "POST_MATCH",
      leagueId: null,
      toModelVersionId: "model-1",
      toCalibrationVersionId: null,
      reason: "manual_rollback"
    });

    expect(rollbackDecisionService.rollbackChampion).toHaveBeenCalledTimes(1);
  });
});
