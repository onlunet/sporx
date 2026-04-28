import { publicContract } from "@sporx/api-contract";
import { CompletedPredictionsAnalytics } from "../../../../src/components/predictions";
import { fetchWithSchema } from "../../../../src/lib/fetch-with-schema";

export const revalidate = 30;

export default async function BasketballCompletedPredictionsPage() {
  let initialItems: any[] | undefined;

  try {
    const response = await fetchWithSchema(
      "/api/v1/predictions?status=finished&sport=basketball&take=180&includeMarketAnalysis=1",
      publicContract.predictionsResponseSchema
    );
    initialItems = response.data;
  } catch {
    initialItems = undefined;
  }

  return <CompletedPredictionsAnalytics sport="basketball" initialItems={initialItems} />;
}
