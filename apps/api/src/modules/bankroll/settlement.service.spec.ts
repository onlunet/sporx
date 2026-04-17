import { MatchStatus } from "@prisma/client";
import { SettlementService } from "./settlement.service";

describe("SettlementService", () => {
  const service = new SettlementService();

  it("settles full-time result home as WON", () => {
    const outcome = service.evaluateSingleLeg(
      {
        market: "fullTimeResult",
        selection: "home",
        line: null,
        fullTimeScore: { home: 2, away: 1 },
        halfTimeScore: { home: 1, away: 0 },
        matchStatus: MatchStatus.finished
      },
      10,
      1.9
    );

    expect(outcome.status).toBe("WON");
    expect(outcome.payout).toBe(19);
    expect(outcome.pnl).toBe(9);
  });

  it("returns OPEN when score missing", () => {
    const outcome = service.evaluateSingleLeg(
      {
        market: "fullTimeResult",
        selection: "home",
        line: null,
        fullTimeScore: null,
        halfTimeScore: null,
        matchStatus: MatchStatus.finished
      },
      10,
      1.8
    );

    expect(outcome.status).toBe("OPEN");
  });

  it("returns CANCELLED for cancelled matches", () => {
    const outcome = service.evaluateSingleLeg(
      {
        market: "fullTimeResult",
        selection: "home",
        line: null,
        fullTimeScore: null,
        halfTimeScore: null,
        matchStatus: MatchStatus.cancelled
      },
      10,
      1.8
    );

    expect(outcome.status).toBe("CANCELLED");
    expect(outcome.payout).toBe(10);
    expect(outcome.pnl).toBe(0);
  });
});
