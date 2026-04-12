import { z } from "zod";
import { envelopeSchema, publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../../src/lib/fetch-with-schema";

const teamMatchSchema = z.object({
  id: z.string().uuid(),
  matchDateTimeUTC: z.string(),
  status: z.string(),
  homeScore: z.number().nullable(),
  awayScore: z.number().nullable(),
  homeTeam: z.object({ name: z.string() }),
  awayTeam: z.object({ name: z.string() }),
  league: z.object({ name: z.string() })
});

interface TeamDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TeamDetailPage({ params }: TeamDetailPageProps) {
  const resolved = await params;

  const [teamResponse, formResponse, matchesResponse] = await Promise.all([
    fetchWithSchema(`/api/v1/teams/${resolved.id}`, publicContract.teamResponseSchema),
    fetchWithSchema(`/api/v1/teams/${resolved.id}/form`, publicContract.teamFormResponseSchema),
    fetchWithSchema(`/api/v1/teams/${resolved.id}/matches`, envelopeSchema(z.array(teamMatchSchema)))
  ]);

  const team = teamResponse.data;
  const form = formResponse.data;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{team.name}</h1>
        <p className="text-sm text-slate-400">{team.country ?? "Bilinmiyor"}</p>
      </div>

      <div className="rounded-md border border-slate-700 p-3 text-sm">
        <p>Son {form.matches} maç puanı: {form.points}</p>
        <p>Maç başı ortalama puan: {form.avgPoints.toFixed(2)}</p>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-semibold">Son Maçlar</h2>
        <ul className="space-y-2">
          {matchesResponse.data.map((match: (typeof matchesResponse.data)[number]) => (
            <li key={match.id} className="rounded-md border border-slate-700 p-3 text-sm">
              <p>
                {match.homeTeam.name} {match.homeScore ?? "-"} - {match.awayScore ?? "-"} {match.awayTeam.name}
              </p>
              <p className="text-xs text-slate-400">
                {match.league.name} | {new Date(match.matchDateTimeUTC).toLocaleString("tr-TR")}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

