import { PredictionsExplorer } from "../../../src/components/predictions";

export default function FootballPredictionsPage() {
  return (
    <PredictionsExplorer
      scope="upcoming"
      sport="football"
      title="Futbol Tahminleri"
      description="Futbol maclari icin modelin urettigi tahminleri ve guven skorlarini ayri olarak takip edin."
    />
  );
}
