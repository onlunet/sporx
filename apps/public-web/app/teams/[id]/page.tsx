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
  const isValidId = z.string().uuid().safeParse(resolved.id).success;
  if (!isValidId) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Geçersiz takım kimliği.
      </div>
    );
  }

  let team: z.infer<typeof publicContract.teamResponseSchema>["data"] | null = null;
  let form: z.infer<typeof publicContract.teamFormResponseSchema>["data"] | null = null;
  let matches: z.infer<typeof teamMatchSchema>[] = [];

  try {
    const [teamResponse, formResponse, matchesResponse] = await Promise.all([
      fetchWithSchema(`/api/v1/teams/${resolved.id}`, publicContract.teamResponseSchema),
      fetchWithSchema(`/api/v1/teams/${resolved.id}/form`, publicContract.teamFormResponseSchema),
      fetchWithSchema(`/api/v1/teams/${resolved.id}/matches`, envelopeSchema(z.array(teamMatchSchema)))
    ]);

    team = teamResponse.data;
    form = formResponse.data;
    matches = matchesResponse.data;
  } catch {
    team = null;
    form = null;
    matches = [];
  }

  if (!team || !form) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Takım detayları şu an yüklenemiyor. Lütfen daha sonra tekrar deneyin.
      </div>
    );
  }

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
          {matches.map((match) => (
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

