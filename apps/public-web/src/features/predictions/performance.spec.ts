import { describe, expect, it } from "vitest";
import { explainFailedPrediction, explainFailedPredictionFactors } from "./performance";
import { MatchPredictionItem } from "./types";

function buildItem(overrides: Partial<MatchPredictionItem>): MatchPredictionItem {
  return {
    matchId: "match-1",
    predictionType: "fullTimeResult",
    probabilities: { home: 0.55, draw: 0.25, away: 0.2 },
    expectedScore: { home: 1.4, away: 1.1 },
    confidenceScore: 0.68,
    homeScore: 1,
    awayScore: 2,
    halfTimeHomeScore: 1,
    halfTimeAwayScore: 0,
    matchStatus: "finished",
    homeTeam: "Ev",
    awayTeam: "Dep",
    contradictionSignals: [],
    riskFlags: [],
    ...overrides
  };
}

describe("explainFailedPrediction", () => {
  it("prioritizes lineup uncertainty and missing stats", () => {
    const result = explainFailedPredictionFactors(
      buildItem({
        riskFlags: [
          { code: "LOW_LINEUP_CERTAINTY", severity: "high", message: "Lineup certainty is low close to kickoff." },
          { code: "HIGH_MISSING_STATS_RATIO", severity: "high", message: "Coverage is low." }
        ]
      })
    );

    expect(result).toEqual([
      "Kadro belirsizdi; oyuncu bazlı sinyal maça yakın netleşmedi.",
      "İstatistik kapsamı düşüktü; maç formu ve olay verisi eksik kaldı."
    ]);
  });

  it("explains market contradiction and volatility", () => {
    const result = explainFailedPrediction(
      buildItem({
        riskFlags: [],
        marketAnalysis: {
          contradictionScore: 0.31,
          probabilityGap: 0.18,
          volatilityScore: 0.24
        }
      })
    );

    expect(result).toBe("Model ile piyasa ciddi ayrıştı; fiyatlama modeli teyit etmedi. Piyasa hareketi oynaktı; maç önü denge kararsızdı.");
  });

  it("falls back to low-confidence model weakness", () => {
    const result = explainFailedPrediction(
      buildItem({
        confidenceScore: 0.44,
        expectedScore: { home: 1.12, away: 1.08 }
      })
    );

    expect(result).toBe("Model kenarı zayıftı; güven skoru bu seçim için düşük kaldı. Beklenen skor dengeliydi; model net bir taraf üstünlüğü kuramamıştı.");
  });

  it("returns null for successful picks", () => {
    const result = explainFailedPrediction(
      buildItem({
        homeScore: 2,
        awayScore: 1
      })
    );

    expect(result).toBeNull();
  });

  it("returns empty factors for successful picks", () => {
    const result = explainFailedPredictionFactors(
      buildItem({
        homeScore: 2,
        awayScore: 1
      })
    );

    expect(result).toEqual([]);
  });
});
