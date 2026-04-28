import { z } from "zod";
import { envelopeSchema } from "@sporx/api-contract";
import { fetchWithSchema } from "../../../../src/lib/fetch-with-schema";
import { PublicMatchDetailExperience } from "../../../../src/components/matches";

const matchDetailSchema = z.object({
  id: z.string().uuid(),
  matchDateTimeUTC: z.string(),
  status: z.string(),
  homeScore: z.number().nullable(),
  awayScore: z.number().nullable(),
  halfTimeHomeScore: z.number().nullable(),
  halfTimeAwayScore: z.number().nullable(),
  q1HomeScore: z.number().nullable().optional(),
  q1AwayScore: z.number().nullable().optional(),
  q2HomeScore: z.number().nullable().optional(),
  q2AwayScore: z.number().nullable().optional(),
  q3HomeScore: z.number().nullable().optional(),
  q3AwayScore: z.number().nullable().optional(),
  q4HomeScore: z.number().nullable().optional(),
  q4AwayScore: z.number().nullable().optional(),
  homeElo: z.number().nullable(),
  awayElo: z.number().nullable(),
  league: z.object({ name: z.string() }),
  season: z.object({ yearLabel: z.string() }),
  homeTeam: z.object({ name: z.string() }),
  awayTeam: z.object({ name: z.string() })
});

const predictionSchema = z
  .object({
    matchId: z.string().uuid().optional(),
    predictionType: z.string().optional(),
    confidenceScore: z.number().optional(),
    summary: z.string().optional(),
    avoidReason: z.string().nullable().optional(),
    updatedAt: z.string().nullable().optional(),
    probabilities: z.record(z.number()).optional(),
    expectedScore: z
      .object({
        home: z.number().optional(),
        away: z.number().optional()
      })
      .optional(),
    commentary: z.unknown().optional(),
    supportingSignals: z.unknown().optional(),
    contradictionSignals: z.unknown().optional(),
    scorelineDistribution: z.unknown().optional(),
    riskFlags: z.unknown().optional(),
    marketKey: z.string().optional(),
    selectionLabel: z.string().optional(),
    line: z.number().optional()
  })
  .passthrough()
  .nullable();

interface BasketballMatchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function BasketballMatchDetailPage({ params }: BasketballMatchDetailPageProps) {
  const resolved = await params;
  const isValidId = z.string().uuid().safeParse(resolved.id).success;
  if (!isValidId) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Geçersiz maç kimliği.
      </div>
    );
  }

  const [matchResult, predictionResult] = await Promise.allSettled([
    fetchWithSchema(`/api/v1/matches/${resolved.id}`, envelopeSchema(matchDetailSchema)),
    fetchWithSchema(`/api/v1/matches/${resolved.id}/prediction?includeMarketAnalysis=1`, envelopeSchema(predictionSchema))
  ]);

  return (
    <PublicMatchDetailExperience
      matchId={resolved.id}
      sport="basketball"
      initialMatch={matchResult.status === "fulfilled" ? matchResult.value.data : null}
      initialPrediction={predictionResult.status === "fulfilled" ? predictionResult.value.data : null}
    />
  );
}
