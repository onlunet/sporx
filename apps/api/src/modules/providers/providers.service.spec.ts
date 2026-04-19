import { ProvidersService } from "./providers.service";

describe("ProvidersService", () => {
  const createService = (prisma: Record<string, unknown>) =>
    new ProvidersService(prisma as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);

  it("falls back to provider catalog when provider tables are missing", async () => {
    const prisma = {
      provider: {
        upsert: jest.fn().mockRejectedValue(new Error("relation providers does not exist")),
        findMany: jest.fn()
      },
      providerConfig: {
        upsert: jest.fn()
      }
    };

    const service = createService(prisma);
    const providers = await service.listProviders();

    expect(providers.length).toBeGreaterThan(0);
    expect(providers.some((item: any) => item.key === "football_data")).toBe(true);
  });

  it("returns active fallback providers for ingestion when schema is missing", async () => {
    const prisma = {
      provider: {
        upsert: jest.fn().mockRejectedValue(new Error("relation providers does not exist")),
        findMany: jest.fn()
      },
      providerConfig: {
        upsert: jest.fn()
      }
    };

    const service = createService(prisma);
    const activeProviders = await service.listActiveApiProviders();

    expect(activeProviders.length).toBeGreaterThan(0);
    expect(activeProviders.some((item: any) => item.key === "football_data")).toBe(true);
    expect(activeProviders.some((item: any) => item.key === "historical_csv")).toBe(false);
  });

  it("builds runtime settings from catalog defaults when provider config tables are unavailable", async () => {
    const prisma = {
      provider: {
        upsert: jest.fn().mockRejectedValue(new Error("relation providers does not exist")),
        findUnique: jest.fn()
      },
      providerConfig: {
        upsert: jest.fn()
      }
    };

    const service = createService(prisma);
    const settings = await service.getProviderRuntimeSettings("football_data");

    expect(settings.maxCallsPerRun).toBe(12);
    expect(settings.competitionCodes).toEqual(
      expect.arrayContaining(["WC", "CL", "BL1", "PL"])
    );
  });
});
