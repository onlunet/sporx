import { describe, expect, it } from "vitest";
import { predictionSelectionLabel } from "./presentation";

describe("prediction presentation", () => {
  it("uses over/under probabilities when selection label is only the market name", () => {
    expect(
      predictionSelectionLabel({
        matchId: "match-1",
        predictionType: "totalGoalsOverUnder",
        marketKey: "over_under_2.5",
        selectionLabel: "MS 2.5 Alt/Üst",
        line: 2.5,
        probabilities: { over: 0.3442, under: 0.6558 }
      })
    ).toBe("MS 2.5 Alt");
  });

  it("keeps explicit over/under selection labels", () => {
    expect(
      predictionSelectionLabel({
        matchId: "match-2",
        predictionType: "totalGoalsOverUnder",
        marketKey: "over_under_2.5",
        selectionLabel: "MS 2.5 Üst",
        line: 2.5,
        probabilities: { over: 0.48, under: 0.52 }
      })
    ).toBe("MS 2.5 Üst");
  });
});
