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
  const response = await fetchWithSchema("/api/v1/teams?take=10000", publicContract.teamsResponseSchema);

  return <TeamSearchExplorer teams={response.data} initialQuery={String(params.q ?? "")} />;
}
