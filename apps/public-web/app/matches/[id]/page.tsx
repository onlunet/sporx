import { z } from "zod";
import { envelopeSchema } from "@sporx/api-contract";
import { fetchWithSchema } from "../../../src/lib/fetch-with-schema";
import { normalizePredictionItem } from "../../../src/features/predictions";
import { MatchPredictionExperience } from "../../../src/components/predictions";

const matchDetailSchema = z.object({
  id: z.string().uuid(),
  matchDateTimeUTC: z.string(),
  status: z.string(),
  homeScore: z.number().nullable(),
  awayScore: z.number().nullable(),
  halfTimeHomeScore: z.number().nullable(),
  halfTimeAwayScore: z.number().nullable(),
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

interface MatchDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function MatchDetailPage({ params }: MatchDetailPageProps) {
  const resolved = await params;
  const matchResponse = await fetchWithSchema(`/api/v1/matches/${resolved.id}`, envelopeSchema(matchDetailSchema));

  let predictionData: z.infer<typeof predictionSchema> = null;
  try {
    const predictionResponse = await fetchWithSchema(
      `/api/v1/matches/${resolved.id}/prediction`,
      envelopeSchema(predictionSchema)
    );
    predictionData = predictionResponse.data;
  } catch {
    predictionData = null;
  }

  const match = matchResponse.data;
  const initialPrediction = normalizePredictionItem(
    predictionData
      ? predictionData
      : {
          matchId: resolved.id,
          predictionType: "fullTimeResult"
        }
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">
          {match.homeTeam.name} - {match.awayTeam.name}
        </h1>
        <p className="text-sm text-slate-400">
          {match.league.name} | {match.season.yearLabel} | {new Date(match.matchDateTimeUTC).toLocaleString("tr-TR")}
        </p>
      </div>

      <div className="rounded-md border border-slate-700 p-3 text-sm">
        <p>
          Skor: {match.homeScore ?? "-"} - {match.awayScore ?? "-"}
        </p>
        <p>
          İlk Yarı: {match.halfTimeHomeScore ?? "-"} - {match.halfTimeAwayScore ?? "-"}
        </p>
        <p>
          Elo: {match.homeElo?.toFixed(2) ?? "Bilinmiyor"} / {match.awayElo?.toFixed(2) ?? "Bilinmiyor"}
        </p>
      </div>

      <MatchPredictionExperience matchId={resolved.id} initialPrediction={initialPrediction} />
    </div>
  );
}

