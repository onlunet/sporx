import { PredictionsExplorer } from "../../../src/components/predictions";

export default function BasketballPredictionsPage() {
  return (
    <PredictionsExplorer
      scope="upcoming"
      sport="basketball"
      title="Basketbol Tahminleri"
      description="Basketbolda 4 periyot dinamiklerini baz alan, oynanmamis mac tahminlerini bu bolumde takip edebilirsiniz."
    />
  );
}
