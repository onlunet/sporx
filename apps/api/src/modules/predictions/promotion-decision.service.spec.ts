import { PromotionDecisionStatus } from "@prisma/client";
import { PromotionDecisionService } from "./promotion-decision.service";

describe("PromotionDecisionService", () => {
  const prisma = {
    promotionDecision: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({
        id: "promotion-1",
        ...data
      }))
    }
  } as any;

  const modelAliasService = {
    lineKey: jest.fn().mockReturnValue("na"),
    scopeLeagueKey: jest.fn().mockReturnValue("global")
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("requires minimum sample size before promotion", () => {
    const service = new PromotionDecisionService(prisma, modelAliasService);
    const result = service.evaluate({
      sampleSize: 80,
      minimumSampleSize: 120,
      championLogLoss: 0.64,
      challengerLogLoss: 0.61,
      championBrier: 0.22,
      challengerBrier: 0.21,
      championCalibrationDrift: 0.02,
      challengerCalibrationDrift: 0.02,
      championLatencyP95Ms: 120,
      challengerLatencyP95Ms: 118,
      challengerFallbackRate: 0.03,
      challengerErrorRate: 0.01,
      maxLatencyP95Ms: 220,
      maxFallbackRate: 0.08,
      maxErrorRate: 0.05,
      minLogLossImprovement: 0.005,
      minBrierImprovement: 0.003,
      maxCalibrationRegression: 0.01
    });

    expect(result.status).toBe(PromotionDecisionStatus.EXTEND_SHADOW);
    expect(result.minimumSampleSizeMet).toBe(false);
  });

  it("blocks promotion when calibration regresses", () => {
    const service = new PromotionDecisionService(prisma, modelAliasService);
    const result = service.evaluate({
      sampleSize: 180,
      minimumSampleSize: 120,
      championLogLoss: 0.64,
      challengerLogLoss: 0.62,
      championBrier: 0.22,
      challengerBrier: 0.2,
      championCalibrationDrift: 0.01,
      challengerCalibrationDrift: 0.04,
      championLatencyP95Ms: 120,
      challengerLatencyP95Ms: 118,
      challengerFallbackRate: 0.03,
      challengerErrorRate: 0.01,
      maxLatencyP95Ms: 220,
      maxFallbackRate: 0.08,
      maxErrorRate: 0.05,
      minLogLossImprovement: 0.005,
      minBrierImprovement: 0.003,
      maxCalibrationRegression: 0.01
    });

    expect(result.status).toBe(PromotionDecisionStatus.KEEP_CHAMPION);
    expect(result.reasons).toContain("calibration_regression");
  });

  it("persists deterministic promotion decision", async () => {
    const service = new PromotionDecisionService(prisma, modelAliasService);
    const output = await service.evaluateAndPersist({
      sport: "football",
      market: "match_outcome",
      line: null,
      horizon: "POST_MATCH",
      leagueId: null,
      championModelVersionId: "model-a",
      challengerModelVersionId: "model-b",
      championCalibrationVersionId: null,
      challengerCalibrationVersionId: null,
      challengerEvaluationId: "eval-1",
      sampleSize: 180,
      minimumSampleSize: 120,
      championLogLoss: 0.64,
      challengerLogLoss: 0.62,
      championBrier: 0.22,
      challengerBrier: 0.2,
      championCalibrationDrift: 0.02,
      challengerCalibrationDrift: 0.021,
      championLatencyP95Ms: 120,
      challengerLatencyP95Ms: 122,
      challengerFallbackRate: 0.03,
      challengerErrorRate: 0.01,
      maxLatencyP95Ms: 220,
      maxFallbackRate: 0.08,
      maxErrorRate: 0.05,
      minLogLossImprovement: 0.005,
      minBrierImprovement: 0.003,
      maxCalibrationRegression: 0.01,
      actor: "system",
      effectiveAt: new Date("2026-04-17T08:00:00.000Z")
    });

    expect(output.evaluation.status).toBe(PromotionDecisionStatus.PROMOTE);
    expect(prisma.promotionDecision.create).toHaveBeenCalledTimes(1);
    expect(output.decision.status).toBe(PromotionDecisionStatus.PROMOTE);
  });
});
