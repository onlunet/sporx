import { z } from "zod";
import { envelopeSchema, publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../../src/lib/fetch-with-schema";

const standingSchema = z.object({
  id: z.string().uuid(),
  played: z.number(),
  won: z.number(),
  draw: z.number(),
  lost: z.number(),
  goalsFor: z.number(),
  goalsAgainst: z.number(),
  points: z.number(),
  rank: z.number().nullable(),
  team: z.object({
    id: z.string().uuid(),
    name: z.string()
  }),
  season: z.object({
    id: z.string().uuid(),
    yearLabel: z.string()
  })
});

interface LeagueDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function LeagueDetailPage({ params }: LeagueDetailPageProps) {
  const resolved = await params;
  const isValidId = z.string().uuid().safeParse(resolved.id).success;
  if (!isValidId) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Geçersiz lig kimliği.
      </div>
    );
  }

  let league: z.infer<typeof publicContract.leagueResponseSchema>["data"] | null = null;
  let standings: z.infer<typeof standingSchema>[] = [];
  let standingsLoadError = false;

  try {
    const leagueResponse = await fetchWithSchema(`/api/v1/leagues/${resolved.id}`, publicContract.leagueResponseSchema);
    league = leagueResponse.data;
  } catch {
    league = null;
  }

  try {
    const standingsResponse = await fetchWithSchema(
      `/api/v1/leagues/${resolved.id}/standings`,
      envelopeSchema(z.array(standingSchema))
    );
    standings = standingsResponse.data;
  } catch {
    standings = [];
    standingsLoadError = true;
  }

  if (!league) {
    return (
      <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
        Lig detayları şu an yüklenemiyor. Lütfen daha sonra tekrar deneyin.
      </div>
    );
  }

  const sortedStandings = [...standings].sort((a, b) => {
    const rankA = a.rank ?? Number.MAX_SAFE_INTEGER;
    const rankB = b.rank ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) {
      return rankA - rankB;
    }
    return b.points - a.points;
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">{league.name}</h1>
        <p className="text-sm text-slate-400">{league.country ?? "Bilinmiyor"}</p>
      </div>

      {standingsLoadError ? (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          Puan durumu şu an yüklenemiyor.
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-slate-700">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-900/70 text-left text-xs text-slate-300">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Takım</th>
              <th className="px-3 py-2">O</th>
              <th className="px-3 py-2">G</th>
              <th className="px-3 py-2">B</th>
              <th className="px-3 py-2">M</th>
              <th className="px-3 py-2">A</th>
            </tr>
          </thead>
          <tbody>
            {sortedStandings.slice(0, 30).map((row, index) => (
              <tr key={row.id} className="border-t border-slate-800">
                <td className="px-3 py-2">{row.rank ?? index + 1}</td>
                <td className="px-3 py-2">{row.team.name}</td>
                <td className="px-3 py-2">{row.played}</td>
                <td className="px-3 py-2">{row.won}</td>
                <td className="px-3 py-2">{row.draw}</td>
                <td className="px-3 py-2">{row.lost}</td>
                <td className="px-3 py-2">{row.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

