import { z } from "zod";
import { envelopeSchema } from "@sporx/api-contract";
import { fetchWithSchema } from "../../../../src/lib/fetch-with-schema";
import { normalizePredictionItem } from "../../../../src/features/predictions";
import { MatchPredictionExperience } from "../../../../src/components/predictions";

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

function splitHalfToQuarters(total: number) {
  const safe = Math.max(0, total);
  const first = Math.round(safe * 0.49);
  return { first, second: safe - first };
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

  let match: z.infer<typeof matchDetailSchema> | null = null;
  try {
    const matchResponse = await fetchWithSchema(`/api/v1/matches/${resolved.id}`, envelopeSchema(matchDetailSchema));
    match = matchResponse.data;
  } catch {
    match = null;
  }

  if (!match) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Maç detayı şu an yüklenemiyor. Lütfen daha sonra tekrar deneyin.
      </div>
    );
  }

  let predictionData: z.infer<typeof predictionSchema> = null;
  try {
    const predictionResponse = await fetchWithSchema(
      `/api/v1/matches/${resolved.id}/prediction?includeMarketAnalysis=1`,
      envelopeSchema(predictionSchema)
    );
    predictionData = predictionResponse.data;
  } catch {
    predictionData = null;
  }

  const canBuildQuarterFromHalf =
    match.homeScore !== null &&
    match.awayScore !== null &&
    match.halfTimeHomeScore !== null &&
    match.halfTimeAwayScore !== null;

  const hasProviderQuarterScores =
    match.q1HomeScore !== null &&
    match.q1HomeScore !== undefined &&
    match.q1AwayScore !== null &&
    match.q1AwayScore !== undefined &&
    match.q2HomeScore !== null &&
    match.q2HomeScore !== undefined &&
    match.q2AwayScore !== null &&
    match.q2AwayScore !== undefined &&
    match.q3HomeScore !== null &&
    match.q3HomeScore !== undefined &&
    match.q3AwayScore !== null &&
    match.q3AwayScore !== undefined &&
    match.q4HomeScore !== null &&
    match.q4HomeScore !== undefined &&
    match.q4AwayScore !== null &&
    match.q4AwayScore !== undefined;

  const quarterEstimate = canBuildQuarterFromHalf
    ? (() => {
        const homeFirst = splitHalfToQuarters(match.halfTimeHomeScore ?? 0);
        const awayFirst = splitHalfToQuarters(match.halfTimeAwayScore ?? 0);
        const homeSecond = splitHalfToQuarters(Math.max(0, (match.homeScore ?? 0) - (match.halfTimeHomeScore ?? 0)));
        const awaySecond = splitHalfToQuarters(Math.max(0, (match.awayScore ?? 0) - (match.halfTimeAwayScore ?? 0)));
        return {
          q1: `${homeFirst.first}-${awayFirst.first}`,
          q2: `${homeFirst.second}-${awayFirst.second}`,
          q3: `${homeSecond.first}-${awaySecond.first}`,
          q4: `${homeSecond.second}-${awaySecond.second}`
        };
      })()
    : null;

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
          Maç Skoru: {match.homeScore ?? "-"} - {match.awayScore ?? "-"}
        </p>
        <p>
          İlk 2 Periyot: {match.halfTimeHomeScore ?? "-"} - {match.halfTimeAwayScore ?? "-"}
        </p>
        <p>
          Son 2 Periyot:{" "}
          {match.homeScore !== null && match.awayScore !== null && match.halfTimeHomeScore !== null && match.halfTimeAwayScore !== null
            ? `${Math.max(0, match.homeScore - match.halfTimeHomeScore)} - ${Math.max(0, match.awayScore - match.halfTimeAwayScore)}`
            : "-"}
        </p>
        {hasProviderQuarterScores ? (
          <p>
            4 Periyot (provider): Q1 {match.q1HomeScore}-{match.q1AwayScore} | Q2 {match.q2HomeScore}-{match.q2AwayScore} | Q3{" "}
            {match.q3HomeScore}-{match.q3AwayScore} | Q4 {match.q4HomeScore}-{match.q4AwayScore}
          </p>
        ) : quarterEstimate ? (
          <p>
            4 Periyot (tahmini dağılım): Q1 {quarterEstimate.q1} | Q2 {quarterEstimate.q2} | Q3 {quarterEstimate.q3} | Q4{" "}
            {quarterEstimate.q4}
          </p>
        ) : null}
        <p>
          Elo: {match.homeElo?.toFixed(2) ?? "Bilinmiyor"} / {match.awayElo?.toFixed(2) ?? "Bilinmiyor"}
        </p>
      </div>

      <MatchPredictionExperience matchId={resolved.id} initialPrediction={initialPrediction} sport="basketball" />
    </div>
  );
}