import { MatchStatus } from "@prisma/client";
import { ProviderIngestionService } from "./provider-ingestion.service";

function createService() {
  const seen = new Set<string>();
  const prisma = {
    ingestionCheckpoint: {
      findUnique: jest.fn(async ({ where }: any) => {
        const entityType = where?.providerKey_entityType?.entityType;
        if (typeof entityType === "string" && seen.has(entityType)) {
          return { providerKey: "prediction_phase_trigger" };
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        seen.add(String(data.entityType));
        return data;
      })
    }
  };

  const service = new ProviderIngestionService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  jest.spyOn(service as any, "createExternalPayload").mockResolvedValue(undefined);
  jest.spyOn(service as any, "generatePredictions").mockResolvedValue({
    recordsRead: 0,
    recordsWritten: 0,
    errors: 0,
    logs: {}
  });

  return { service, prisma };
}

describe("ProviderIngestionService phase triggers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds halftime trigger only when HT exists and FT is not final", () => {
    const { service } = createService();
    const triggers = (service as any).buildPredictionPhaseTriggers(
      {
        id: "match-1",
        kickoffAt: new Date("2026-04-18T11:00:00.000Z"),
        status: MatchStatus.live,
        homeScore: null,
        awayScore: null,
        halfTimeHomeScore: 1,
        halfTimeAwayScore: 0
      },
      new Date("2026-04-18T11:40:00.000Z")
    );

    expect(triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "halftime",
          dedupKey: "match:match-1:ht:1-0",
          horizon: "HT"
        })
      ])
    );
  });

  it("keeps halftime trigger idempotent across reruns", async () => {
    const { service } = createService();
    const candidate = {
      phase: "halftime",
      dedupKey: "match:match-2:ht:2-1",
      matchId: "match-2",
      horizon: "HT",
      metadata: {}
    };

    await (service as any).processPredictionPhaseTriggers("run-1", [candidate]);
    await (service as any).processPredictionPhaseTriggers("run-2", [candidate]);

    const generatePredictions = (service as any).generatePredictions as jest.Mock;
    expect(generatePredictions).toHaveBeenCalledTimes(1);
    expect(generatePredictions).toHaveBeenCalledWith("run-1:halftime", {
      matchIds: ["match-2"],
      reason: "phase_trigger_halftime"
    });
  });

  it("keeps fulltime trigger idempotent across reruns", async () => {
    const { service } = createService();
    const candidate = {
      phase: "fulltime",
      dedupKey: "match:match-3:ft:3-1",
      matchId: "match-3",
      horizon: "POST_MATCH",
      metadata: {}
    };

    await (service as any).processPredictionPhaseTriggers("run-3", [candidate]);
    await (service as any).processPredictionPhaseTriggers("run-4", [candidate]);

    const generatePredictions = (service as any).generatePredictions as jest.Mock;
    expect(generatePredictions).toHaveBeenCalledTimes(1);
    expect(generatePredictions).toHaveBeenCalledWith("run-3:fulltime", {
      matchIds: ["match-3"],
      reason: "phase_trigger_fulltime"
    });
  });
});
