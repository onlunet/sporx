import { describe, expect, it } from "vitest";
import {
  filterPredictionsByType,
  getTabAvailability,
  isLowConfidence,
  nextAvailableTab,
  normalizePredictionItem
} from "./normalize";
import { MatchPredictionItem } from "./types";

function sample(predictionType: MatchPredictionItem["predictionType"], confidenceScore = 0.61): MatchPredictionItem {
  return {
    matchId: "00000000-0000-0000-0000-000000000001",
    predictionType,
    confidenceScore,
    probabilities: { home: 0.4, draw: 0.3, away: 0.3 }
  };
}

describe("prediction normalize", () => {
  it("normalizes scoreline distribution items", () => {
    const item = normalizePredictionItem({
      matchId: "00000000-0000-0000-0000-000000000001",
      predictionType: "correctScore",
      scorelineDistribution: [
        { home: 1, away: 0, probability: 0.22 },
        { homeGoals: 2, awayGoals: 1, prob: 0.15 }
      ]
    });

    expect(item?.scorelineDistribution?.length).toBe(2);
    expect(item?.scorelineDistribution?.[0].label).toBe("1-0");
  });

  it("normalizes commentary payload", () => {
    const item = normalizePredictionItem({
      matchId: "00000000-0000-0000-0000-000000000001",
      predictionType: "fullTimeResult",
      commentary: {
        shortComment: "Kısa",
        detailedComment: "Detay",
        expertComment: "Uzman",
        confidenceNote: "Temkinli"
      }
    });

    expect(item?.commentary?.shortComment).toBe("Kısa");
    expect(item?.commentary?.expertComment).toBe("Uzman");
  });

  it("filters predictions by type", () => {
    const rows: MatchPredictionItem[] = [sample("fullTimeResult"), sample("bothTeamsToScore")];
    const filtered = filterPredictionsByType(rows, "bothTeamsToScore");
    expect(filtered.length).toBe(1);
    expect(filtered[0].predictionType).toBe("bothTeamsToScore");
  });

  it("marks low confidence correctly", () => {
    expect(isLowConfidence(sample("fullTimeResult", 0.49))).toBe(true);
    expect(isLowConfidence(sample("fullTimeResult", 0.62))).toBe(false);
  });

  it("handles empty availability and picks next tab", () => {
    const availability = getTabAvailability({});
    expect(availability.general).toBe(false);
    expect(nextAvailableTab("btts", availability)).toBe("general");
  });

  it("computes tab availability when data exists", () => {
    const availability = getTabAvailability({
      fullTimeResult: [sample("fullTimeResult")],
      totalGoalsOverUnder: [sample("totalGoalsOverUnder")],
      bothTeamsToScore: [sample("bothTeamsToScore")]
    });
    expect(availability.general).toBe(true);
    expect(availability.btts).toBe(true);
    expect(availability.overUnder).toBe(true);
  });

  it("ignores inconsistent played flag for future scheduled matches", () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const item = normalizePredictionItem({
      matchId: "00000000-0000-0000-0000-000000000100",
      predictionType: "fullTimeResult",
      matchStatus: "scheduled",
      matchDateTimeUTC: future,
      isPlayed: true
    });

    expect(item?.isPlayed).toBe(false);
  });

  it("marks stale scheduled past matches as played", () => {
    const past = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const item = normalizePredictionItem({
      matchId: "00000000-0000-0000-0000-000000000101",
      predictionType: "fullTimeResult",
      matchStatus: "scheduled",
      matchDateTimeUTC: past
    });

    expect(item?.isPlayed).toBe(true);
  });
});
