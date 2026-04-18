import {
  classifyFootballCompetitionBucket,
  deriveFootballRequestBudget,
  resolveFootballCadenceMinutes,
  selectFootballCompetitionsForRun
} from "./football-data-optimization.util";

describe("football-data optimization util", () => {
  it("classifies HOT/WARM/COLD correctly", () => {
    expect(
      classifyFootballCompetitionBucket({
        hasLive: true,
        hasKickoffInNext6Hours: false,
        hasKickoffIn6To24Hours: false,
        hasRecentFinishedAwaitingReconciliation: false
      })
    ).toBe("HOT");

    expect(
      classifyFootballCompetitionBucket({
        hasLive: false,
        hasKickoffInNext6Hours: false,
        hasKickoffIn6To24Hours: true,
        hasRecentFinishedAwaitingReconciliation: false
      })
    ).toBe("WARM");

    expect(
      classifyFootballCompetitionBucket({
        hasLive: false,
        hasKickoffInNext6Hours: false,
        hasKickoffIn6To24Hours: false,
        hasRecentFinishedAwaitingReconciliation: false
      })
    ).toBe("COLD");
  });

  it("applies fixtures and standings cadence rules", () => {
    expect(resolveFootballCadenceMinutes("fixtures", "HOT")).toBe(5);
    expect(resolveFootballCadenceMinutes("fixtures", "WARM")).toBe(10);
    expect(resolveFootballCadenceMinutes("fixtures", "COLD")).toBe(60);
    expect(resolveFootballCadenceMinutes("standings", "HOT")).toBe(360);
    expect(resolveFootballCadenceMinutes("standings", "COLD")).toBe(720);
  });

  it("degrades planned budget safely after 429", () => {
    const normal = deriveFootballRequestBudget({
      hardLimitPerMinute: 10,
      plannedTargetPerMinute: 8,
      reservePerMinute: 2
    });
    const degraded = deriveFootballRequestBudget({
      hardLimitPerMinute: 10,
      plannedTargetPerMinute: 8,
      reservePerMinute: 2,
      hadRecent429: true
    });

    expect(normal.plannedCalls).toBe(8);
    expect(degraded.plannedCalls).toBeLessThanOrEqual(4);
    expect(degraded.reserveCalls).toBe(2);
  });

  it("uses remaining header to preserve reserve headroom", () => {
    const budget = deriveFootballRequestBudget({
      hardLimitPerMinute: 10,
      plannedTargetPerMinute: 8,
      reservePerMinute: 2,
      remainingHeader: 3
    });

    expect(budget.plannedCalls).toBe(1);
    expect(budget.reserveCalls).toBe(2);
  });

  it("selects competitions by HOT/WARM/COLD priority with dynamic max calls", () => {
    const now = new Date("2026-04-18T12:00:00.000Z");
    const result = selectFootballCompetitionsForRun({
      mode: "fixtures",
      competitionCodes: ["PL", "CL", "SA", "PD"],
      signalsByCode: {
        PL: {
          hasLive: true,
          hasKickoffInNext6Hours: false,
          hasKickoffIn6To24Hours: false,
          hasRecentFinishedAwaitingReconciliation: false
        },
        CL: {
          hasLive: false,
          hasKickoffInNext6Hours: true,
          hasKickoffIn6To24Hours: false,
          hasRecentFinishedAwaitingReconciliation: false
        },
        SA: {
          hasLive: false,
          hasKickoffInNext6Hours: false,
          hasKickoffIn6To24Hours: true,
          hasRecentFinishedAwaitingReconciliation: false
        },
        PD: {
          hasLive: false,
          hasKickoffInNext6Hours: false,
          hasKickoffIn6To24Hours: false,
          hasRecentFinishedAwaitingReconciliation: false
        }
      },
      lastPolledAtByCode: {},
      now,
      plannedCalls: 2,
      maxCallsCap: 12
    });

    expect(result.selectedCompetitionCodes).toEqual(["CL", "PL"]);
    expect(result.deferredCompetitionCodes).toContain("SA");
    expect(result.deferredCompetitionCodes).toContain("PD");
  });

  it("prevents cold starvation when cold competition is stale", () => {
    const now = new Date("2026-04-18T12:00:00.000Z");
    const stale = new Date("2026-04-17T00:00:00.000Z");
    const fresh = new Date("2026-04-18T11:58:00.000Z");
    const result = selectFootballCompetitionsForRun({
      mode: "fixtures",
      competitionCodes: ["PL", "CL", "SA"],
      signalsByCode: {
        PL: {
          hasLive: true,
          hasKickoffInNext6Hours: false,
          hasKickoffIn6To24Hours: false,
          hasRecentFinishedAwaitingReconciliation: false
        },
        CL: {
          hasLive: true,
          hasKickoffInNext6Hours: false,
          hasKickoffIn6To24Hours: false,
          hasRecentFinishedAwaitingReconciliation: false
        },
        SA: {
          hasLive: false,
          hasKickoffInNext6Hours: false,
          hasKickoffIn6To24Hours: false,
          hasRecentFinishedAwaitingReconciliation: false
        }
      },
      lastPolledAtByCode: {
        PL: fresh,
        CL: fresh,
        SA: stale
      },
      now,
      plannedCalls: 1,
      maxCallsCap: 6
    });

    expect(result.selectedCompetitionCodes[0]).toBe("SA");
  });
});
