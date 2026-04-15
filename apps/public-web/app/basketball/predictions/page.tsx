import { PredictionsExplorer } from "../../../src/components/predictions";

export default function BasketballPredictionsPage() {
  return (
    <PredictionsExplorer
      scope="upcoming"
      sport="basketball"
      title="Basketbol Tahminleri"
      description="Basketbol maclari icin uretilen canli ve yaklasan tahminleri bu bolumde takip edebilirsiniz."
    />
  );
}
