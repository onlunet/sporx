import { expandPredictionMarkets, PredictionRowInput } from "../prediction-markets.util";
import { FootballPredictionStrategy } from "./football-prediction.strategy";

describe("FootballPredictionStrategy", () => {
  const strategy = new FootballPredictionStrategy();

  it("matches legacy market expansion output", () => {
    const input: PredictionRowInput = {
      matchId: "11111111-1111-1111-1111-111111111111",
      modelVersionId: "22222222-2222-2222-2222-222222222222",
      probabilities: { home: 0.55, draw: 0.24, away: 0.21 },
      calibratedProbabilities: { home: 0.54, draw: 0.25, away: 0.21 },
      rawProbabilities: { home: 0.56, draw: 0.23, away: 0.21 },
      expectedScore: { home: 1.62, away: 1.08 },
      confidenceScore: 0.71,
      summary: "Sample summary",
      riskFlags: [],
      avoidReason: null,
      updatedAt: new Date("2026-04-10T10:00:00.000Z"),
      match: {
        homeTeam: { name: "Team A" },
        awayTeam: { name: "Team B" },
        matchDateTimeUTC: new Date("2026-04-11T18:00:00.000Z"),
        status: "scheduled",
        homeScore: null,
        awayScore: null,
        halfTimeHomeScore: null,
        halfTimeAwayScore: null
      }
    };

    expect(strategy.expand(input)).toEqual(expandPredictionMarkets(input));
  });
});

