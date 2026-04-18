import { MatchStatus } from "@prisma/client";
import { AdminProvidersController } from "./admin-providers.controller";

describe("AdminProvidersController", () => {
  it("returns referee inspect rows from context snapshots", async () => {
    const providersService = {
      providerHealth: jest.fn(),
      listProviders: jest.fn(),
      updateProvider: jest.fn(),
      getProviderConfigs: jest.fn(),
      patchProviderConfigs: jest.fn()
    };
    const prisma = {
      matchFeatureSnapshot: {
        findMany: jest.fn().mockResolvedValue([
          {
            matchId: "match-1",
            generatedAt: new Date("2026-04-18T12:00:00.000Z"),
            features: {
              refereeName: "Hakem A",
              refereeSource: "provider_official"
            },
            match: {
              matchDateTimeUTC: new Date("2026-04-18T18:00:00.000Z"),
              status: MatchStatus.live,
              homeTeam: { name: "Ev" },
              awayTeam: { name: "Dep" },
              league: { name: "Lig" }
            }
          }
        ])
      }
    };

    const controller = new AdminProvidersController(providersService as any, prisma as any);
    const result = await controller.footballDataReferees();

    expect(result.meta.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      matchId: "match-1",
      referee: {
        name: "Hakem A",
        source: "provider_official"
      }
    });
  });
});
