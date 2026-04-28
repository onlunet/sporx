"use client";

import { useQuery } from "@tanstack/react-query";
import { resolveBrowserApiBase } from "../../lib/api-base-url";
import { MatchPredictionExperience } from "../predictions";
import { normalizePredictionItem } from "../../features/predictions";

type SportScope = "football" | "basketball";

type MatchDetail = {
  id: string;
  matchDateTimeUTC: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  halfTimeHomeScore: number | null;
  halfTimeAwayScore: number | null;
  q1HomeScore?: number | null;
  q1AwayScore?: number | null;
  q2HomeScore?: number | null;
  q2AwayScore?: number | null;
  q3HomeScore?: number | null;
  q3AwayScore?: number | null;
  q4HomeScore?: number | null;
  q4AwayScore?: number | null;
  homeElo: number | null;
  awayElo: number | null;
  league: { name: string };
  season: { yearLabel: string };
  homeTeam: { name: string };
  awayTeam: { name: string };
};

type PublicMatchDetailExperienceProps = {
  matchId: string;
  sport: SportScope;
  initialMatch?: MatchDetail | null;
  initialPrediction?: unknown;
};

type Envelope<T> = {
  success: boolean;
  data: T;
  meta: unknown;
  error: unknown;
};

function splitHalfToQuarters(total: number) {
  const safe = Math.max(0, total);
  const first = Math.round(safe * 0.49);
  return { first, second: safe - first };
}

async function fetchMatchDetail(matchId: string): Promise<MatchDetail> {
  const apiBase = resolveBrowserApiBase(process.env.NEXT_PUBLIC_API_URL);
  const response = await fetch(`${apiBase}/api/v1/matches/${matchId}`, {
    cache: "no-store",
    credentials: "include"
  });
  if (!response.ok) {
    throw new Error(`match_detail_${response.status}`);
  }
  const json = (await response.json()) as Envelope<MatchDetail>;
  if (!json?.data) {
    throw new Error("match_detail_empty");
  }
  return json.data;
}

export function PublicMatchDetailExperience({
  matchId,
  sport,
  initialMatch = null,
  initialPrediction
}: PublicMatchDetailExperienceProps) {
  const matchQuery = useQuery({
    queryKey: ["public-match-detail", sport, matchId],
    queryFn: () => fetchMatchDetail(matchId),
    initialData: initialMatch ?? undefined,
    staleTime: 60_000,
    retry: 1,
    refetchOnWindowFocus: false
  });

  const match = matchQuery.data ?? initialMatch;
  const normalizedPrediction = normalizePredictionItem(
    initialPrediction
      ? initialPrediction
      : {
          matchId,
          predictionType: "fullTimeResult"
        }
  );

  if (matchQuery.isLoading && !match) {
    return <p className="text-sm text-slate-400">Maç detayı yükleniyor...</p>;
  }

  if (matchQuery.isError && !match) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Maç detayı şu an yüklenemiyor. Lütfen daha sonra tekrar deneyin.
      </div>
    );
  }

  if (!match) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Maç detayı bulunamadı.
      </div>
    );
  }

  const canBuildQuarterFromHalf =
    sport === "basketball" &&
    match.homeScore !== null &&
    match.awayScore !== null &&
    match.halfTimeHomeScore !== null &&
    match.halfTimeAwayScore !== null;

  const hasProviderQuarterScores =
    sport === "basketball" &&
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

  const quarterEstimate =
    sport === "basketball" && canBuildQuarterFromHalf
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
          {sport === "basketball" ? "Maç Skoru" : "Skor"}: {match.homeScore ?? "-"} - {match.awayScore ?? "-"}
        </p>
        <p>
          {sport === "basketball" ? "İlk 2 Periyot" : "İlk Yarı"}: {match.halfTimeHomeScore ?? "-"} - {match.halfTimeAwayScore ?? "-"}
        </p>
        {sport === "basketball" ? (
          <p>
            Son 2 Periyot:{" "}
            {match.homeScore !== null &&
            match.awayScore !== null &&
            match.halfTimeHomeScore !== null &&
            match.halfTimeAwayScore !== null
              ? `${Math.max(0, match.homeScore - match.halfTimeHomeScore)} - ${Math.max(0, match.awayScore - match.halfTimeAwayScore)}`
              : "-"}
          </p>
        ) : null}
        {sport === "basketball" && hasProviderQuarterScores ? (
          <p>
            4 Periyot (provider): Q1 {match.q1HomeScore}-{match.q1AwayScore} | Q2 {match.q2HomeScore}-{match.q2AwayScore} | Q3{" "}
            {match.q3HomeScore}-{match.q3AwayScore} | Q4 {match.q4HomeScore}-{match.q4AwayScore}
          </p>
        ) : null}
        {sport === "basketball" && !hasProviderQuarterScores && quarterEstimate ? (
          <p>
            4 Periyot (tahmini dağılım): Q1 {quarterEstimate.q1} | Q2 {quarterEstimate.q2} | Q3 {quarterEstimate.q3} | Q4{" "}
            {quarterEstimate.q4}
          </p>
        ) : null}
        <p>
          Elo: {match.homeElo?.toFixed(2) ?? "Bilinmiyor"} / {match.awayElo?.toFixed(2) ?? "Bilinmiyor"}
        </p>
      </div>

      <MatchPredictionExperience matchId={matchId} initialPrediction={normalizedPrediction} sport={sport} />
    </div>
  );
}
