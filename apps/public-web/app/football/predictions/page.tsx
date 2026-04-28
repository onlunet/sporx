import { publicContract } from "@sporx/api-contract";
import { PredictionsExplorer } from "../../../src/components/predictions";
import { fetchWithSchema } from "../../../src/lib/fetch-with-schema";

export const revalidate = 30;

export default async function FootballPredictionsPage() {
  let initialItems: any[] | undefined;

  try {
    const response = await fetchWithSchema("/api/v1/predictions?take=120", publicContract.predictionsResponseSchema);
    initialItems = Array.isArray(response.data) && response.data.length > 0 ? response.data : undefined;
  } catch {
    initialItems = undefined;
  }

  return (
    <PredictionsExplorer
      scope="upcoming"
      sport="football"
      title="Futbol Tahminleri"
      description="Futbol maçları için modelin ürettiği tahminleri ve güven skorlarını ayrı olarak takip edin."
      initialItems={initialItems}
    />
  );
}
