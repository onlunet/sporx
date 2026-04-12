import { z } from "zod";
import { envelopeSchema } from "../base";

export const matchSummarySchema = z.object({
  id: z.string().uuid(),
  kickoffAt: z.string(),
  leagueName: z.string(),
  homeTeam: z.string(),
  awayTeam: z.string(),
  status: z.string(),
  score: z.object({ home: z.number().nullable(), away: z.number().nullable() })
});

export const predictionSchema = z.object({
  matchId: z.string().uuid(),
  probabilities: z.object({ home: z.number(), draw: z.number(), away: z.number() }),
  confidenceScore: z.number(),
  summary: z.string(),
  riskFlags: z
    .union([
      z.array(z.object({ code: z.string(), severity: z.string(), message: z.string() })),
      z.object({ code: z.string(), severity: z.string(), message: z.string() }),
      z.null()
    ])
    .transform((value) => {
      if (!value) {
        return [];
      }
      return Array.isArray(value) ? value : [value];
    }),
  avoidReason: z.string().nullable(),
  homeTeam: z.string().optional(),
  awayTeam: z.string().optional(),
  matchDateTimeUTC: z.string().optional()
});

export const teamSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  shortName: z.string().nullable(),
  country: z.string().nullable(),
  foundedYear: z.number().nullable(),
  dataSource: z.string().nullable().optional(),
  dataQualityScore: z.number().nullable().optional(),
  importedAt: z.string().nullable().optional(),
  updatedByProcess: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const leagueSchema = z.object({
  id: z.string().uuid(),
  sportId: z.string().uuid(),
  name: z.string(),
  code: z.string().nullable(),
  country: z.string().nullable(),
  dataSource: z.string().nullable().optional(),
  dataQualityScore: z.number().nullable().optional(),
  importedAt: z.string().nullable().optional(),
  updatedByProcess: z.string().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
});

export const dashboardSchema = z.object({
  matchCount: z.number(),
  predictionCount: z.number(),
  lowConfidenceCount: z.number(),
  failedCount: z.number(),
  generatedAt: z.string()
});

export const teamFormSchema = z.object({
  teamId: z.string().uuid(),
  matches: z.number(),
  points: z.number(),
  avgPoints: z.number()
});

export const compareTeamsQuerySchema = z.object({
  homeTeamId: z.string().uuid(),
  awayTeamId: z.string().uuid(),
  seasonId: z.string().uuid().optional()
});

export const compareTeamsResponseSchema = envelopeSchema(
  z.object({
    homeTeamId: z.string().uuid(),
    awayTeamId: z.string().uuid(),
    confidenceScore: z.number(),
    summary: z.string(),
    scenarioNotes: z.array(z.string()),
    axes: z.array(
      z.object({
        key: z.string(),
        homeValue: z.number(),
        awayValue: z.number(),
        advantage: z.enum(["home", "away", "neutral"])
      })
    )
  })
);

export const matchesResponseSchema = envelopeSchema(z.array(matchSummarySchema));
export const predictionsResponseSchema = envelopeSchema(z.array(predictionSchema));
export const teamsResponseSchema = envelopeSchema(z.array(teamSchema));
export const teamResponseSchema = envelopeSchema(teamSchema);
export const leaguesResponseSchema = envelopeSchema(z.array(leagueSchema));
export const leagueResponseSchema = envelopeSchema(leagueSchema);
export const dashboardResponseSchema = envelopeSchema(dashboardSchema);
export const teamFormResponseSchema = envelopeSchema(teamFormSchema);
