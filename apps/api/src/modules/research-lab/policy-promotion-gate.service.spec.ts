import { PolicyPromotionDecisionStatus } from "@prisma/client";
import { PolicyPromotionGateService } from "./policy-promotion-gate.service";

describe("PolicyPromotionGateService", () => {
  const prisma = {
    policyPromotionDecision: {
      upsert: jest.fn().mockImplementation(async ({ create, update }: any) => ({
        id: "decision-1",
        ...(create ?? update)
      }))
    },
    policyPromotionRequest: {
      update: jest.fn().mockResolvedValue({ id: "request-1", status: "queued" })
    },
    $transaction: jest.fn(async (handler: any) => handler(prisma))
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects insufficient evidence candidates", () => {
    const service = new PolicyPromotionGateService(prisma);
    const decision = service.evaluate(
      {
        sampleSize: 80,
        minimumSampleSize: 200,
        robustnessScore: 0.7,
        minimumRobustnessScore: 0.58,
        hasOverfitFlag: false,
        hasSegmentFailure: false,
        auditComplete: true
      },
      false
    );

    expect(decision.status).toBe(PolicyPromotionDecisionStatus.REQUIRE_MORE_EVIDENCE);
    expect(decision.approved).toBe(false);
  });

  it("persists decision deterministically", async () => {
    const service = new PolicyPromotionGateService(prisma);
    const output = await service.evaluateAndPersist({
      requestId: "request-1",
      candidateId: "candidate-1",
      actor: "admin",
      allowCanary: false,
      evaluation: {
        sampleSize: 260,
        minimumSampleSize: 200,
        robustnessScore: 0.74,
        minimumRobustnessScore: 0.58,
        hasOverfitFlag: false,
        hasSegmentFailure: false,
        auditComplete: true
      }
    });

    expect(output.decision.status).toBe(PolicyPromotionDecisionStatus.APPROVE_SHADOW);
    expect(prisma.policyPromotionDecision.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.policyPromotionRequest.update).toHaveBeenCalledTimes(1);
  });
});
