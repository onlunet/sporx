import { ManualOverrideAction } from "@prisma/client";
import { AdminPredictionsController } from "./admin-predictions.controller";

describe("AdminPredictionsController", () => {
  it("low-confidence reads from published predictions and prediction runs", async () => {
    const prisma = {
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([
          {
            predictionRun: {
              id: "run-1",
              matchId: "match-1",
              market: "match_outcome",
              line: null,
              horizon: "PRE6",
              confidence: 0.42,
              riskFlagsJson: [{ code: "LOW_CONFIDENCE", severity: "MEDIUM" }],
              explanationJson: { summary: "low confidence" },
              createdAt: new Date("2026-04-18T10:00:00.000Z")
            }
          }
        ])
      },
      prediction: {
        findMany: jest.fn()
      }
    } as any;

    const controller = new AdminPredictionsController(prisma, {} as any, {} as any);
    const rows = await controller.lowConfidence("10", "0.55");

    expect(prisma.publishedPrediction.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.prediction.findMany).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        id: "run-1",
        matchId: "match-1",
        confidenceScore: 0.42,
        summary: "low confidence"
      })
    );
  });

  it("manual force publish is audited", async () => {
    const prisma = {
      manualPublishOverride: {
        create: jest.fn().mockResolvedValue({ id: "override-force-1" })
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: "audit-1" })
      }
    } as any;

    const controller = new AdminPredictionsController(prisma, {} as any, {} as any);

    await controller.createManualOverride({
      matchId: "match-1",
      market: "match_outcome",
      line: null,
      horizon: "PRE6",
      selection: "home",
      action: "FORCE",
      reason: "ops override",
      actorUserId: "user-1",
      expiresAt: null,
      active: true
    });

    expect(prisma.manualPublishOverride.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: ManualOverrideAction.FORCE
        })
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "manual_force_publish",
          resourceType: "manual_publish_override",
          resourceId: "override-force-1"
        })
      })
    );
  });

  it("manual block publish is audited", async () => {
    const prisma = {
      manualPublishOverride: {
        create: jest.fn().mockResolvedValue({ id: "override-block-1" })
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: "audit-2" })
      }
    } as any;

    const controller = new AdminPredictionsController(prisma, {} as any, {} as any);

    await controller.createManualOverride({
      matchId: "match-2",
      market: "both_teams_to_score",
      line: null,
      horizon: "PRE24",
      selection: "yes",
      action: "BLOCK",
      reason: "market maintenance",
      actorUserId: "user-2",
      expiresAt: null,
      active: true
    });

    expect(prisma.manualPublishOverride.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: ManualOverrideAction.BLOCK
        })
      })
    );
    expect(prisma.auditLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          action: "manual_block_publish",
          resourceType: "manual_publish_override",
          resourceId: "override-block-1"
        })
      })
    );
  });
});
