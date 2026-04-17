import { ExposureCheckService } from "./exposure-check.service";

type ExposureLimitLike = {
  id: string;
  bankrollAccountId: string;
  scopeType: "MATCH" | "OPEN_TOTAL";
  scopeKey: string;
  behavior: "CLIP" | "BLOCK";
  maxFraction: number | null;
  maxAmount: number | null;
  configJson: null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

describe("ExposureCheckService", () => {
  const service = new ExposureCheckService();

  const baseInput = {
    accountId: "acc-1",
    bankrollValue: 1000,
    proposedStake: 60,
    sportCode: "football",
    leagueId: "league-1",
    matchId: "match-1",
    marketFamily: "result",
    horizon: "PRE24",
    calendarKey: "2026-04-17",
    openExposureTotal: 90,
    openExposureByMatch: 10,
    openExposureByLeague: 20,
    openExposureBySport: 90,
    openExposureByFamily: 35,
    openExposureByHorizon: 25,
    openTickets: 3
  };

  it("clips stake when CLIP limit exceeded", () => {
    const limits: ExposureLimitLike[] = [
      {
        id: "l-1",
        bankrollAccountId: "acc-1",
        scopeType: "MATCH",
        scopeKey: "*",
        behavior: "CLIP",
        maxFraction: 0.03,
        maxAmount: null,
        configJson: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    const result = service.evaluate(baseInput, limits as any);

    expect(result.status).toBe("CLIPPED");
    expect(result.stakeAfterGovernance).toBe(20);
  });

  it("blocks stake when BLOCK limit exceeded", () => {
    const limits: ExposureLimitLike[] = [
      {
        id: "l-1",
        bankrollAccountId: "acc-1",
        scopeType: "OPEN_TOTAL",
        scopeKey: "*",
        behavior: "BLOCK",
        maxFraction: 0.1,
        maxAmount: null,
        configJson: null,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ];

    const result = service.evaluate(baseInput, limits as any);

    expect(result.status).toBe("BLOCKED");
    expect(result.stakeAfterGovernance).toBe(0);
  });
});
