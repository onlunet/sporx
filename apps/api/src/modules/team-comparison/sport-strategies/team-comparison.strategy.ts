import { Team } from "@prisma/client";

export type TeamComparisonSportCode = "football" | "basketball";

export type ResolvedTeamComparisonInput = {
  canonicalId: string;
  canonicalTeam: Team;
  equivalentIds: string[];
};

export type TeamComparisonStrategyInput = {
  homeResolved: ResolvedTeamComparisonInput;
  awayResolved: ResolvedTeamComparisonInput;
  seasonId?: string;
};

export interface TeamComparisonStrategy {
  readonly sport: TeamComparisonSportCode;
  compare(input: TeamComparisonStrategyInput): Promise<{
    homeTeamId: string;
    awayTeamId: string;
    homeTeamName: string;
    awayTeamName: string;
    confidenceScore: number;
    summary: string;
    scenarioNotes: string[];
    axes: Array<{
      key: string;
      homeValue: number;
      awayValue: number;
      advantage: "home" | "away" | "neutral";
    }>;
    outcomeProbabilities: {
      homeWin: number;
      draw: number;
      awayWin: number;
    };
    analysisMeta: {
      homeSampleSize: number;
      awaySampleSize: number;
      homeScoredSampleSize: number;
      awayScoredSampleSize: number;
      fallbackUsed: boolean;
    };
  }>;
}

