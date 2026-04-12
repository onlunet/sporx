import { MatchPredictionItem } from "../../features/predictions";
import { ScorelineProbabilityList } from "./ScorelineProbabilityList";

export function ScorelineDistributionCard({ prediction }: { prediction?: MatchPredictionItem | null }) {
  const distribution = prediction?.scorelineDistribution ?? [];

  return (
    <section className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="text-sm font-semibold text-slate-100">Skor Dağılımı</h4>
      <p className="mt-1 text-xs text-slate-400">
        Bu liste en olası skor senaryolarını gösterir; kesin sonuç vaadi vermez.
      </p>
      <div className="mt-3">
        <ScorelineProbabilityList items={distribution} />
      </div>
    </section>
  );
}

