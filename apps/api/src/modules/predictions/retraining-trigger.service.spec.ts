import { RetrainingTriggerType } from "@prisma/client";
import { RetrainingTriggerService } from "./retraining-trigger.service";

describe("RetrainingTriggerService", () => {
  const prisma = {
    retrainingTrigger: {
      upsert: jest.fn().mockImplementation(async ({ where, create }: any) => ({
        id: "trigger-1",
        dedupKey: where.dedupKey,
        ...create
      })),
      update: jest.fn().mockResolvedValue({ id: "trigger-1" })
    }
  } as any;

  const modelAliasService = {
    lineKey: jest.fn().mockReturnValue("na"),
    scopeLeagueKey: jest.fn().mockReturnValue("global")
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("deduplicates duplicate retraining triggers via stable dedup key", async () => {
    const service = new RetrainingTriggerService(prisma, modelAliasService);

    const input = {
      triggerType: RetrainingTriggerType.DRIFT_THRESHOLD,
      sport: "football",
      market: "match_outcome",
      line: null,
      horizon: "POST_MATCH",
      leagueId: null,
      reasonPayload: {
        source: "unit-test"
      }
    } as const;

    await service.createOrUpdate(input);
    await service.createOrUpdate(input);

    expect(prisma.retrainingTrigger.upsert).toHaveBeenCalledTimes(2);

    const firstWhere = prisma.retrainingTrigger.upsert.mock.calls[0][0].where;
    const secondWhere = prisma.retrainingTrigger.upsert.mock.calls[1][0].where;
    expect(firstWhere.dedupKey).toBe(secondWhere.dedupKey);
  });
});
