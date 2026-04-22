import { expandPredictionMarkets, PredictionRowInput } from "./prediction-markets.util";

function buildRow(overrides: Partial<PredictionRowInput> = {}): PredictionRowInput {
  return {
    matchId: "11111111-1111-1111-1111-111111111111",
    modelVersionId: "22222222-2222-2222-2222-222222222222",
    probabilities: { home: 0.45, draw: 0.28, away: 0.27 },
    calibratedProbabilities: { home: 0.44, draw: 0.29, away: 0.27 },
    rawProbabilities: { home: 0.46, draw: 0.27, away: 0.27 },
    expectedScore: { home: 1.45, away: 1.2, marketCoverageScore: 0.5 },
    confidenceScore: 0.72,
    summary: "Sample summary",
    riskFlags: [],
    avoidReason: null,
    updatedAt: new Date("2026-04-20T10:00:00.000Z"),
    match: {
      homeTeam: { name: "Team A" },
      awayTeam: { name: "Team B" },
      matchDateTimeUTC: new Date("2026-04-21T18:00:00.000Z"),
      status: "scheduled",
      homeScore: null,
      awayScore: null,
      halfTimeHomeScore: null,
      halfTimeAwayScore: null
    },
    ...overrides
  };
}

describe("expandPredictionMarkets market refinement", () => {
  it("keeps derived markets visible and attaches diagnostics", () => {
    const items = expandPredictionMarkets(buildRow());
    const marketKeys = items.map((item) => item.marketKey);

    expect(marketKeys).toEqual(
      expect.arrayContaining([
        "match_outcome",
        "first_half_outcome",
        "half_time_full_time",
        "both_teams_to_score",
        "over_under_1.5",
        "over_under_2.5",
        "over_under_3.5",
        "correct_score",
        "goal_range",
        "first_half_goals",
        "second_half_goals"
      ])
    );
    expect(items.find((item) => item.marketKey === "both_teams_to_score")?.marketRefinementDiagnostics).toMatchObject({
      version: "market_refinement_v1",
      marketFamily: "both_teams_to_score",
      method: "symmetry_clean_sheet_adjustment"
    });
  });

  it("applies clean-sheet sensitivity to both-teams-to-score without suppressing the market", () => {
    const item = expandPredictionMarkets(
      buildRow({
        expectedScore: { home: 1.9, away: 0.25 },
        probabilities: { home: 0.66, draw: 0.22, away: 0.12 }
      })
    ).find((row) => row.marketKey === "both_teams_to_score");

    expect(item).toBeDefined();
    expect(item?.probabilities.yes).toBeLessThan(item?.probabilities.no ?? 0);
    expect(item?.marketRefinementDiagnostics?.signals.cleanSheetSensitivity).toEqual(expect.any(Number));
    expect(item?.marketRefinementDiagnostics?.probabilityAdjustment?.yesDelta).toBeLessThan(0);
  });

  it("penalizes correct-score confidence when entropy and volatility are high", () => {
    const item = expandPredictionMarkets(
      buildRow({
        expectedScore: { home: 2.0, away: 1.8 },
        confidenceDiagnostics: { volatilityScore: 0.82 },
        confidenceScore: 0.74
      })
    ).find((row) => row.marketKey === "correct_score");

    expect(item).toBeDefined();
    expect(item?.confidenceScore).toBeLessThan(0.62);
    expect(item?.marketRefinementDiagnostics).toMatchObject({
      method: "entropy_volatility_penalty",
      signals: expect.objectContaining({
        entropy: expect.any(Number),
        volatility: expect.any(Number)
      })
    });
  });

  it("adjusts over-under lines with tempo and odds agreement signals", () => {
    const item = expandPredictionMarkets(
      buildRow({
        expectedScore: { home: 2.2, away: 1.6, marketCoverageScore: 0.82 }
      })
    ).find((row) => row.marketKey === "over_under_2.5");

    expect(item).toBeDefined();
    expect(item?.marketRefinementDiagnostics).toMatchObject({
      marketFamily: "total_goals_over_under",
      method: "tempo_odds_agreement_adjustment",
      signals: expect.objectContaining({
        tempoScore: expect.any(Number),
        oddsAgreement: 0.82
      })
    });
    expect(item?.marketRefinementDiagnostics?.probabilityAdjustment?.overDelta).toBeGreaterThan(0);
  });

  it("adds half-specific pace diagnostics to first and second half goal markets", () => {
    const items = expandPredictionMarkets(buildRow({ expectedScore: { home: 1.8, away: 1.4 } }));
    const firstHalfGoals = items.find((row) => row.marketKey === "first_half_goals");
    const secondHalfGoals = items.find((row) => row.marketKey === "second_half_goals");

    expect(firstHalfGoals?.marketRefinementDiagnostics).toMatchObject({
      marketFamily: "first_half",
      method: "half_specific_pace_adjustment"
    });
    expect(secondHalfGoals?.marketRefinementDiagnostics).toMatchObject({
      marketFamily: "second_half",
      method: "half_specific_pace_adjustment"
    });
  });
});
