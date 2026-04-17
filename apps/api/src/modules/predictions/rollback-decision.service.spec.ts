import { ServingAliasType } from "@prisma/client";
import { RollbackDecisionService } from "./rollback-decision.service";

describe("RollbackDecisionService", () => {
  const prisma = {
    rollbackEvent: {
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: "rollback-1", ...data }))
    }
  } as any;

  const modelAliasService = {
    lineKey: jest.fn().mockReturnValue("na"),
    scopeLeagueKey: jest.fn().mockReturnValue("global"),
    resolveServingAlias: jest.fn().mockResolvedValue({
      modelVersionId: "model-current",
      calibrationVersionId: "calib-current"
    }),
    switchAlias: jest.fn().mockResolvedValue({ id: "alias-1" })
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("switches champion alias safely on rollback", async () => {
    const service = new RollbackDecisionService(prisma, modelAliasService);

    const result = await service.rollbackChampion({
      sport: "football",
      market: "match_outcome",
      line: null,
      horizon: "POST_MATCH",
      leagueId: null,
      toModelVersionId: "model-previous",
      toCalibrationVersionId: "calib-previous",
      actor: "admin",
      reason: "manual_rollback",
      metadata: {
        source: "unit-test"
      }
    });

    expect(modelAliasService.switchAlias).toHaveBeenCalledWith(
      expect.objectContaining({
        aliasType: ServingAliasType.CHAMPION,
        modelVersionId: "model-previous"
      })
    );
    expect(prisma.rollbackEvent.create).toHaveBeenCalledTimes(1);
    expect(result.alias.id).toBe("alias-1");
    expect(result.rollbackEvent.toModelVersionId).toBe("model-previous");
  });
});
