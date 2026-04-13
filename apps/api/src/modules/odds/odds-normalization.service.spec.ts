import { OddsNormalizationService } from "./odds-normalization.service";

describe("OddsNormalizationService", () => {
  const service = new OddsNormalizationService();

  it("normalizes match result and over/under entries", () => {
    const rows = service.normalizeEventOdds({
      id: 1,
      bookmakers: {
        Bet365: [
          {
            name: "ML",
            odds: [{ home: "2.10", draw: "3.20", away: "3.60" }],
            updatedAt: "2026-04-13T12:00:00Z"
          },
          {
            name: "Over/Under",
            odds: [{ max: 2.5, over: "1.91", under: "1.89" }],
            updatedAt: "2026-04-13T12:00:00Z"
          }
        ]
      }
    });

    const matchResult = rows.filter((item) => item.marketType === "matchResult");
    const overUnder = rows.filter((item) => item.marketType === "totalGoalsOverUnder");

    expect(matchResult).toHaveLength(3);
    expect(overUnder).toHaveLength(2);
    expect(overUnder.find((item) => item.selectionKey === "over")?.line).toBe(2.5);
  });
});
