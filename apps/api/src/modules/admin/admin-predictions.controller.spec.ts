import { ManualOverrideAction } from "@prisma/client";
import { AdminPredictionsController } from "./admin-predictions.controller";

describe("AdminPredictionsController", () => {
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
