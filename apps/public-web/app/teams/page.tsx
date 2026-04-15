import { publicContract } from "@sporx/api-contract";
import { fetchWithSchema } from "../../src/lib/fetch-with-schema";
import { TeamSearchExplorer } from "../../src/components/teams/TeamSearchExplorer";

interface TeamsPageProps {
  searchParams: Promise<{
    q?: string;
  }>;
}

export default async function TeamsPage({ searchParams }: TeamsPageProps) {
  const params = await searchParams;
  let teams: any[] = [];

  try {
    const response = await fetchWithSchema("/api/v1/teams?take=2500", publicContract.teamsResponseSchema);
    teams = response.data;
  } catch {
    teams = [];
  }

  return <TeamSearchExplorer teams={teams} initialQuery={String(params.q ?? "")} />;
}
