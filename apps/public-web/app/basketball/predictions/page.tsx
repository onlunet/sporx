import { PredictionsExplorer } from "../../../src/components/predictions";

export default function BasketballPredictionsPage() {
  return (
    <PredictionsExplorer
      scope="upcoming"
      sport="basketball"
      title="Basketbol Tahminleri"
      description="Basketbolda 4 periyot dinamiklerini baz alan, oynanmamış maç tahminlerini bu bölümde takip edebilirsiniz."
    />
  );
}
