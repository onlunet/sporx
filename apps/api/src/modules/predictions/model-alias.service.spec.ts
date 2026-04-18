import { ServingAliasType } from "@prisma/client";
import { ModelAliasService } from "./model-alias.service";

describe("ModelAliasService", () => {
  const cache = {
    get: jest.fn(),
    set: jest.fn(),
    invalidateTag: jest.fn()
  } as any;

  const prisma = {
    systemSetting: {
      findMany: jest.fn()
    },
    modelAlias: {
      findMany: jest.fn()
    },
    modelVersion: {
      findFirst: jest.fn()
    }
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: "champion_alias_resolution_enabled", value: true }
    ]);
  });

  it("resolves league scoped champion before global", async () => {
    prisma.modelAlias.findMany.mockResolvedValue([
      {
        aliasType: ServingAliasType.CHAMPION,
        modelVersionId: "model-global",
        calibrationVersionId: null,
        featureSetVersion: "v1",
        policyVersion: "p1",
        scopeLeagueKey: "global"
      },
      {
        aliasType: ServingAliasType.CHAMPION,
        modelVersionId: "model-league",
        calibrationVersionId: "calib-1",
        featureSetVersion: "v2",
        policyVersion: "p2",
        scopeLeagueKey: "league-1"
      }
    ]);

    const service = new ModelAliasService(prisma, cache);
    const result = await service.resolveServingAlias({
      sport: "football",
      market: "match_outcome",
      line: null,
      lineKey: "na",
      horizon: "post_match",
      leagueId: "league-1"
    });

    expect(result.modelVersionId).toBe("model-league");
    expect(result.scopeLeagueKey).toBe("league-1");
    expect(result.resolvedViaAlias).toBe(true);
  });

  it("falls back to active model when alias resolution is disabled", async () => {
    prisma.systemSetting.findMany.mockResolvedValue([
      { key: "champion_alias_resolution_enabled", value: false }
    ]);
    prisma.modelVersion.findFirst.mockResolvedValueOnce({
      id: "active-model"
    });

    const service = new ModelAliasService(prisma, cache);
    const result = await service.resolveServingAlias({
      sport: "football",
      market: "match_outcome",
      line: null,
      lineKey: "na",
      horizon: "post_match",
      leagueId: null
    });

    expect(result.modelVersionId).toBe("active-model");
    expect(result.resolvedViaAlias).toBe(false);
  });

  it("falls back to active model when model_aliases table is missing", async () => {
    prisma.modelAlias.findMany.mockRejectedValueOnce(
      Object.assign(new Error("The table `public.model_aliases` does not exist in the current database."), {
        code: "P2021"
      })
    );
    prisma.modelVersion.findFirst.mockResolvedValueOnce({
      id: "active-model"
    });

    const service = new ModelAliasService(prisma, cache);
    const result = await service.resolveServingAlias({
      sport: "football",
      market: "match_outcome",
      line: null,
      lineKey: "na",
      horizon: "post_match",
      leagueId: null
    });

    expect(result.modelVersionId).toBe("active-model");
    expect(result.resolvedViaAlias).toBe(false);
    expect(cache.set).toHaveBeenCalled();
  });
});
