import { publicContract } from "@sporx/api-contract";
import { CompletedPredictionsAnalytics } from "../../../../src/components/predictions";
import { fetchWithSchema } from "../../../../src/lib/fetch-with-schema";

export const revalidate = 30;

export default async function FootballCompletedPredictionsPage() {
  let initialItems: any[] | undefined;

  try {
    const response = await fetchWithSchema("/api/v1/predictions?status=finished&take=180", publicContract.predictionsResponseSchema);
    initialItems = Array.isArray(response.data) && response.data.length > 0 ? response.data : undefined;
  } catch {
    initialItems = undefined;
  }

  return <CompletedPredictionsAnalytics sport="football" initialItems={initialItems} />;
}
