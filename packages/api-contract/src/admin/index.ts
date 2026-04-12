import { z } from "zod";
import { envelopeSchema } from "../base";

export const ingestionRunRequestSchema = z.object({
  jobType: z.enum([
    "syncLeagues",
    "syncTeams",
    "syncPlayers",
    "syncStandings",
    "syncFixtures",
    "syncResults",
    "syncTeamStats",
    "syncPlayerStats",
    "syncMatchEvents",
    "recalculateForms",
    "generateFeatures",
    "generatePredictions",
    "providerHealthCheck",
    "syncBackup",
    "resolveProviderAliases",
    "enrichTeamProfiles",
    "enrichMatchDetails"
  ])
});

export const ingestionRunStatusSchema = z.object({
  id: z.string().uuid(),
  jobType: z.string(),
  status: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  recordsRead: z.number(),
  recordsWritten: z.number(),
  errors: z.number()
});

export const providerHealthSchema = z.object({
  provider: z.string(),
  status: z.enum(["healthy", "degraded", "down"]),
  latencyMs: z.number(),
  checkedAt: z.string(),
  message: z.string().optional()
});

export const ingestionRunResponseSchema = envelopeSchema(ingestionRunStatusSchema);
export const providerHealthResponseSchema = envelopeSchema(z.array(providerHealthSchema));
