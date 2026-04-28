import { publicContract } from "@sporx/api-contract";
import { MatchesExplorer } from "../../../src/components/matches";
import { fetchWithSchema } from "../../../src/lib/fetch-with-schema";

export const revalidate = 30;

export default async function FootballMatchesPage() {
  let matches: any[] = [];
  let loadError = false;

  try {
    const response = await fetchWithSchema("/api/v1/matches?sport=football&take=120", publicContract.matchesResponseSchema);
    matches = response.data.slice(0, 24);
  } catch {
    loadError = true;
  }

  return <MatchesExplorer sport="football" initialMatches={matches} initialLoadError={loadError} />;
}
