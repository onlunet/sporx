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

  const [leagueResponse, standingsResponse] = await Promise.all([
    fetchWithSchema(`/api/v1/leagues/${resolved.id}`, publicContract.leagueResponseSchema),
    fetchWithSchema(`/api/v1/leagues/${resolved.id}/standings`, envelopeSchema(z.array(standingSchema)))
  ]);

  const league = leagueResponse.data;
  const standings = [...standingsResponse.data].sort((a, b) => {
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
            {standings.slice(0, 30).map((row: (typeof standings)[number], index: number) => (
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

