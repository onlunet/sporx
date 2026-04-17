import { CorrelationCheckService } from "./correlation-check.service";

describe("CorrelationCheckService", () => {
  const service = new CorrelationCheckService();

  it("clips when one correlated leg is already open", () => {
    const result = service.evaluate({
      matchId: "m1",
      market: "totalGoalsOverUnder",
      selection: "over",
      line: 2.5,
      horizon: "PRE24",
      proposedStake: 40,
      existingOpenLegs: [
        {
          market: "bothTeamsToScore",
          selection: "yes",
          line: null,
          horizon: "PRE24"
        }
      ]
    });

    expect(result.status).toBe("CLIPPED");
    expect(result.stakeAfterCorrelation).toBe(20);
  });

  it("blocks when multiple correlated legs exist", () => {
    const result = service.evaluate({
      matchId: "m1",
      market: "totalGoalsOverUnder",
      selection: "over",
      line: 2.5,
      horizon: "PRE24",
      proposedStake: 40,
      existingOpenLegs: [
        {
          market: "bothTeamsToScore",
          selection: "yes",
          line: null,
          horizon: "PRE24"
        },
        {
          market: "teamTotalOverUnder",
          selection: "over",
          line: 1.5,
          horizon: "PRE24"
        }
      ]
    });

    expect(result.status).toBe("BLOCKED");
    expect(result.stakeAfterCorrelation).toBe(0);
  });
});
