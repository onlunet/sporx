import { MatchCommentary, MatchPredictionItem } from "../../features/predictions";
import { PredictionRiskBadges } from "./PredictionRiskBadges";
import { SupportingSignalsList } from "./SupportingSignalsList";
import { ContradictionSignalsList } from "./ContradictionSignalsList";

type PredictionCommentaryPanelProps = {
  commentary?: MatchCommentary | null;
  prediction?: MatchPredictionItem | null;
};

function CommentaryBlock({ title, value }: { title: string; value?: string }) {
  if (!value) {
    return null;
  }
  return (
    <section className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h4>
      <p className="mt-1 text-sm text-slate-100">{value}</p>
    </section>
  );
}

export function PredictionCommentaryPanel({ commentary, prediction }: PredictionCommentaryPanelProps) {
  const merged = commentary ?? prediction?.commentary;
  const hasAny =
    !!merged?.shortComment || !!merged?.detailedComment || !!merged?.expertComment || !!merged?.confidenceNote;

  return (
    <div className="space-y-3">
      {hasAny ? (
        <>
          <CommentaryBlock title="Kısa Yorum" value={merged?.shortComment} />
          <CommentaryBlock title="Detaylı Yorum" value={merged?.detailedComment} />
          <CommentaryBlock title="Uzman Yorumu" value={merged?.expertComment} />
          <CommentaryBlock title="Güven Notu" value={merged?.confidenceNote} />
        </>
      ) : (
        <p className="rounded-md border border-slate-700 bg-slate-900/60 p-3 text-sm text-slate-300">
          Bu maç için yorum metni henüz üretilmemiş.
        </p>
      )}

      <section className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Destekleyici Sinyaller</h4>
        <div className="mt-2">
          <SupportingSignalsList items={prediction?.supportingSignals ?? []} />
        </div>
      </section>

      <section className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Çelişen Sinyaller</h4>
        <div className="mt-2">
          <ContradictionSignalsList items={prediction?.contradictionSignals ?? []} />
        </div>
      </section>

      <section className="rounded-md border border-slate-700 bg-slate-900/60 p-3">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Risk Bayrakları</h4>
        <div className="mt-2">
          <PredictionRiskBadges prediction={prediction} />
        </div>
      </section>
    </div>
  );
}

