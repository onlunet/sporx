import { PredictionsExplorer } from "../../../src/components/predictions";

export default function BasketballPredictionsPage() {
  return (
    <PredictionsExplorer
      scope="upcoming"
      sport="basketball"
      title="Basketbol Tahminleri"
      description="Basketbol maçları için üretilen canlı ve yaklaşan tahminleri bu bölümde takip edebilirsiniz."
    />
  );
}

