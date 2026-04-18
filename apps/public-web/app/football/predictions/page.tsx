import { PredictionsExplorer } from "../../../src/components/predictions";

export default function FootballPredictionsPage() {
  return (
    <PredictionsExplorer
      scope="upcoming"
      sport="football"
      title="Futbol Tahminleri"
      description="Futbol maçları için modelin ürettiği tahminleri ve güven skorlarını ayrı olarak takip edin."
    />
  );
}
