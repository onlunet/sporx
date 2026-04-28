import { publicContract } from "@sporx/api-contract";
import { PredictionsExplorer } from "../../../src/components/predictions";
import { fetchWithSchema } from "../../../src/lib/fetch-with-schema";

export const revalidate = 30;

export default async function BasketballPredictionsPage() {
  let initialItems: any[] | undefined;

  try {
    const response = await fetchWithSchema(
      "/api/v1/predictions?status=scheduled,live&sport=basketball&take=120&includeMarketAnalysis=1",
      publicContract.predictionsResponseSchema
    );
    initialItems = response.data;
  } catch {
    initialItems = undefined;
  }

  return (
    <PredictionsExplorer
      scope="upcoming"
      sport="basketball"
      title="Basketbol Tahminleri"
      description="Basketbolda 4 periyot dinamiklerini baz alan, oynanmamış maç tahminlerini bu bölümde takip edebilirsiniz."
      initialItems={initialItems}
    />
  );
}
