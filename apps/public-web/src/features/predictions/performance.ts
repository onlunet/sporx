import { isCompletedMatchStatus, isLiveMatchStatus, predictionTypeLabel } from "./normalize";
import { MatchPredictionItem, PredictionType } from "./types";

export type PredictionAccuracyStats = {
  key: string;
  label: string;
  total: number;
  evaluated: number;
  correct: number;
  failed: number;
  accuracy: number;
};

export type PredictionPerformanceSummary = {
  totalPredictions: number;
  evaluatedPredictions: number;
  correctPredictions: number;
  failedPredictions: number;
  successRate: number;
  uniqueMatchCount: number;
};

export type PredictionPerformanceReport = {
  summary: PredictionPerformanceSummary;
  byType: PredictionAccuracyStats[];
  byEngine: PredictionAccuracyStats[];
  byModel: PredictionAccuracyStats[];
};

export type LeaguePredictionTypePerformance = PredictionAccuracyStats;

export type LeaguePerformanceRow = {
  leagueKey: string;
  leagueLabel: string;
  evaluated: number;
  correct: number;
  failed: number;
  successRate: number;
  uniqueMatchCount: number;
  topTypeLabel: string;
  topTypeAccuracy: number;
  byType: LeaguePredictionTypePerformance[];
};

export type LeaguePredictionPerformanceSummary = {
  leagueCount: number;
  evaluatedPredictions: number;
  correctPredictions: number;
  failedPredictions: number;
  successRate: number;
  uniqueMatchCount: number;
};

export type LeaguePredictionPerformanceReport = {
  summary: LeaguePredictionPerformanceSummary;
  leagues: LeaguePerformanceRow[];
};

function pickTopProbability(probabilities: Record<string, number> | undefined, candidates: string[]): string | null {
  if (!probabilities) {
    return null;
  }
  let bestKey: string | null = null;
  let bestValue = -1;
  for (const key of candidates) {
    const value = probabilities[key];
    if (typeof value === "number" && Number.isFinite(value) && value > bestValue) {
      bestKey = key;
      bestValue = value;
    }
  }
  return bestKey;
}

function asOutcomeKey(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) {
    return "home";
  }
  if (home < away) {
    return "away";
  }
  return "draw";
}

function parseScoreSelection(selectionLabel: string | undefined): { home: number; away: number } | null {
  if (!selectionLabel) {
    return null;
  }
  const match = selectionLabel.match(/(\d+)\s*[-:]\s*(\d+)/);
  if (!match) {
    return null;
  }
  return {
    home: Number(match[1]),
    away: Number(match[2])
  };
}

function resolveGoalRange(totalGoals: number): "low" | "medium" | "high" {
  if (totalGoals <= 1) {
    return "low";
  }
  if (totalGoals <= 3) {
    return "medium";
  }
  return "high";
}

function resolveLine(item: MatchPredictionItem): number {
  if (typeof item.line === "number" && Number.isFinite(item.line)) {
    return item.line;
  }
  if (item.selectionLabel) {
    const match = item.selectionLabel.match(/([0-9]+(?:\.[05])?)/);
    if (match) {
      return Number(match[1]);
    }
  }
  return 0.5;
}

type FailureReason = {
  priority: number;
  text: string;
};

function pushFailureReason(reasons: FailureReason[], text: string, priority: number) {
  if (!text || reasons.some((item) => item.text === text)) {
    return;
  }
  reasons.push({ text, priority });
}

function mapRiskFlagToReason(code: string): FailureReason | null {
  switch (code) {
    case "LOW_LINEUP_CERTAINTY":
      return { priority: 100, text: "Kadro belirsizdi; oyuncu bazlı sinyal maça yakın netleşmedi." };
    case "NO_LINEUP_COVERAGE":
    case "LOW_LINEUP_COVERAGE":
    case "MISSING_LINEUP_REQUIRED":
      return { priority: 95, text: "Kadro verisi eksikti; model ilk 11 etkisini yeterince okuyamadı." };
    case "HIGH_MISSING_STATS_RATIO":
    case "LOW_EVENT_COVERAGE":
    case "MISSING_EVENT_STATS":
      return { priority: 92, text: "İstatistik kapsamı düşüktü; maç formu ve olay verisi eksik kaldı." };
    case "LOW_ELO_COVERAGE":
    case "ELO_BACKFILLED":
      return { priority: 85, text: "Takım güç verisi zayıftı; rating tarafı tahmini/backfill beslendi." };
    case "LOW_CALIBRATION_SAMPLE":
    case "LOW_HISTORICAL_SUPPORT":
      return { priority: 84, text: "Geçmiş örnek sayısı sınırlıydı; kalibrasyon yeterince oturmadı." };
    case "NO_ODDS_COVERAGE":
    case "MISSING_ODDS":
      return { priority: 83, text: "Piyasa oran referansı eksikti; model dış teyit alamadı." };
    case "PROVIDER_DISAGREEMENT":
    case "HIGH_PROVIDER_DISAGREEMENT":
      return { priority: 82, text: "Kaynaklar arasında ayrışma vardı; veri güveni düştü." };
    case "ALIAS_CONFIDENCE_LOW":
      return { priority: 80, text: "Takım eşleştirme güveni zayıftı; provider verisi tam oturmadı." };
    case "WEATHER_VARIANCE":
      return { priority: 78, text: "Hava koşulları varyansı artırdı; maç akışı modelden saptı." };
    case "REFEREE_STRICTNESS":
      return { priority: 74, text: "Hakem profili maç akışını etkileyebilecek kadar sertti." };
    case "REFEREE_DATA_ESTIMATED":
      return { priority: 72, text: "Hakem verisi resmi kaynaktan gelmedi; bu bağlam tahmini kaldı." };
    case "ADVANCED_ENGINE_FALLBACK":
    case "META_MODEL_FALLBACK":
      return { priority: 70, text: "Ana model yerine fallback akış devreye girdi; tahmin kalitesi zayıflamış olabilir." };
    case "CONFLICTING_SIGNALS":
      return { priority: 68, text: "Model iç sinyalleri birbiriyle çelişti; net yön oluşmadı." };
    case "HIGH_VARIANCE_MATCH":
    case "HIGH_VOLATILITY":
    case "MEDIUM_VARIANCE":
    case "UNSTABLE_LAMBDA":
      return { priority: 66, text: "Maç varyansı yüksekti; model istikrarlı bir senaryo kuramadı." };
    case "LOW_CONFIDENCE":
    case "LOW_PUBLISH_SCORE":
      return { priority: 64, text: "Model güven skoru zaten düşüktü; kenar yeterince güçlü değildi." };
    case "STALE_DATA":
      return { priority: 62, text: "Veri tazeliği zayıftı; model eski bağlamla karar verdi." };
    case "LOW_SCORE_BIAS":
      return { priority: 55, text: "Model düşük skorlu senaryoya fazla yaslandı; maç akışı bunu bozdu." };
    default:
      return null;
  }
}

function resolvedHalfTimeScore(item: MatchPredictionItem): { home: number; away: number } | null {
  if (
    item.halfTimeHomeScore !== null &&
    item.halfTimeHomeScore !== undefined &&
    item.halfTimeAwayScore !== null &&
    item.halfTimeAwayScore !== undefined
  ) {
    return {
      home: item.halfTimeHomeScore,
      away: item.halfTimeAwayScore
    };
  }

  if (item.quarterBreakdown) {
    return {
      home: item.quarterBreakdown.q1.home + item.quarterBreakdown.q2.home,
      away: item.quarterBreakdown.q1.away + item.quarterBreakdown.q2.away
    };
  }

  return null;
}

function evaluatePrediction(item: MatchPredictionItem): boolean | null {
  const homeScore = item.homeScore;
  const awayScore = item.awayScore;
  if (homeScore === null || homeScore === undefined || awayScore === null || awayScore === undefined) {
    return null;
  }

  const fullTimeOutcome = asOutcomeKey(homeScore, awayScore);
  const totalGoals = homeScore + awayScore;

  if (item.predictionType === "fullTimeResult") {
    const predicted = pickTopProbability(item.probabilities, ["home", "draw", "away"]);
    return predicted ? predicted === fullTimeOutcome : null;
  }

  if (item.predictionType === "bothTeamsToScore") {
    const predictedRaw = pickTopProbability(item.probabilities, ["yes", "no", "bttsYes", "bttsNo"]);
    if (!predictedRaw) {
      return null;
    }
    const predicted = predictedRaw === "yes" || predictedRaw === "bttsYes" ? "yes" : "no";
    const actual = homeScore > 0 && awayScore > 0 ? "yes" : "no";
    return predicted === actual;
  }

  if (item.predictionType === "totalGoalsOverUnder") {
    const predicted = pickTopProbability(item.probabilities, ["over", "under"]);
    if (!predicted) {
      return null;
    }
    const line = resolveLine(item);
    const actual = totalGoals > line ? "over" : "under";
    return predicted === actual;
  }

  if (item.predictionType === "correctScore") {
    const top = item.scorelineDistribution?.[0];
    const predictedScore =
      top && typeof top.home === "number" && typeof top.away === "number"
        ? { home: top.home, away: top.away }
        : parseScoreSelection(item.selectionLabel);
    if (!predictedScore) {
      return null;
    }
    return predictedScore.home === homeScore && predictedScore.away === awayScore;
  }

  if (item.predictionType === "goalRange") {
    const predicted = pickTopProbability(item.probabilities, ["low", "medium", "high"]);
    if (!predicted) {
      return null;
    }
    return predicted === resolveGoalRange(totalGoals);
  }

  if (item.predictionType === "firstHalfResult") {
    const half = resolvedHalfTimeScore(item);
    if (!half) {
      return null;
    }
    const predicted = pickTopProbability(item.probabilities, ["home", "draw", "away"]);
    if (!predicted) {
      return null;
    }
    return predicted === asOutcomeKey(half.home, half.away);
  }

  if (item.predictionType === "halfTimeFullTime") {
    const half = resolvedHalfTimeScore(item);
    if (!half) {
      return null;
    }
    const predicted = pickTopProbability(item.probabilities, ["HH", "HD", "HA", "DH", "DD", "DA", "AH", "AD", "AA"]);
    if (!predicted) {
      return null;
    }
    const halfOutcome = asOutcomeKey(half.home, half.away);
    const full = fullTimeOutcome;
    const encode = (value: "home" | "draw" | "away") => (value === "home" ? "H" : value === "draw" ? "D" : "A");
    return predicted === `${encode(halfOutcome)}${encode(full)}`;
  }

  if (item.predictionType === "firstHalfGoals" || item.predictionType === "secondHalfGoals") {
    const half = resolvedHalfTimeScore(item);
    if (!half) {
      return null;
    }
    const predicted = pickTopProbability(item.probabilities, ["over", "under"]);
    if (!predicted) {
      return null;
    }
    const line = resolveLine(item);
    const actualTotal =
      item.predictionType === "firstHalfGoals"
        ? half.home + half.away
        : Math.max(0, homeScore + awayScore - (half.home + half.away));
    const actual = actualTotal > line ? "over" : "under";
    return predicted === actual;
  }

  return null;
}

export function evaluatePredictionResult(item: MatchPredictionItem): boolean | null {
  return evaluatePrediction(item);
}

export function explainFailedPredictionFactors(item: MatchPredictionItem): string[] {
  if (evaluatePrediction(item) !== false) {
    return [];
  }

  const reasons: FailureReason[] = [];

  for (const flag of item.riskFlags ?? []) {
    const mapped = mapRiskFlagToReason(flag.code);
    if (mapped) {
      pushFailureReason(reasons, mapped.text, mapped.priority);
    }
  }

  const contradictionScore = Math.max(0, item.marketAnalysis?.contradictionScore ?? 0);
  const probabilityGap = Math.abs(item.marketAnalysis?.probabilityGap ?? 0);
  const volatilityScore = Math.max(0, item.marketAnalysis?.volatilityScore ?? 0);

  if (contradictionScore >= 0.22) {
    pushFailureReason(reasons, "Model ile piyasa ciddi ayrıştı; fiyatlama modeli teyit etmedi.", 90);
  } else if (probabilityGap >= 0.14) {
    pushFailureReason(reasons, "Model ile piyasa olasılık farkı yüksekti; maç önü fiyatlama farklı yöndeydi.", 76);
  }

  if (volatilityScore >= 0.18) {
    pushFailureReason(reasons, "Piyasa hareketi oynaktı; maç önü denge kararsızdı.", 74);
  }

  if (typeof item.confidenceScore === "number" && item.confidenceScore < 0.55) {
    pushFailureReason(reasons, "Model kenarı zayıftı; güven skoru bu seçim için düşük kaldı.", 73);
  }

  if (item.avoidReason) {
    if (/kadro/i.test(item.avoidReason)) {
      pushFailureReason(reasons, "Kadro tarafındaki belirsizlik tahmini temkinli hale getirmişti.", 88);
    } else if (/guven skoru dusuk|güven skoru düşük/i.test(item.avoidReason)) {
      pushFailureReason(reasons, "Tahmin zaten düşük güven skoruyla üretilmişti.", 72);
    } else if (/degiskenlik yuksek|değişkenlik yüksek/i.test(item.avoidReason)) {
      pushFailureReason(reasons, "Model bu maçta yüksek varyans uyarısı vermişti.", 71);
    }
  }

  if (
    item.expectedScore &&
    typeof item.expectedScore.home === "number" &&
    typeof item.expectedScore.away === "number" &&
    Math.abs(item.expectedScore.home - item.expectedScore.away) < 0.2 &&
    (item.predictionType === "fullTimeResult" || item.predictionType === "firstHalfResult" || item.predictionType === "halfTimeFullTime")
  ) {
    pushFailureReason(reasons, "Beklenen skor dengeliydi; model net bir taraf üstünlüğü kuramamıştı.", 60);
  }

  if (reasons.length === 0) {
    const contradictionDetail = item.contradictionSignals?.find((signal) => signal.detail && signal.detail.trim().length > 0)?.detail;
    if (contradictionDetail) {
      pushFailureReason(reasons, contradictionDetail.trim(), 55);
    }
  }

  if (reasons.length === 0) {
    return ["Belirgin veri açığı işaretlenmedi; model bu maçın varyansını doğru ayıramadı."];
  }

  return reasons
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 2)
    .map((item) => item.text);
}

export function explainFailedPrediction(item: MatchPredictionItem): string | null {
  if (evaluatePrediction(item) !== false) {
    return null;
  }
  return explainFailedPredictionFactors(item).join(" ");
}

function roundPercentage(value: number): number {
  return Number((value * 100).toFixed(1));
}

function toStats(key: string, label: string, values: Array<boolean | null>): PredictionAccuracyStats {
  const evaluatedValues = values.filter((value): value is boolean => value !== null);
  const correct = evaluatedValues.filter((value) => value).length;
  const failed = evaluatedValues.length - correct;
  return {
    key,
    label,
    total: values.length,
    evaluated: evaluatedValues.length,
    correct,
    failed,
    accuracy: evaluatedValues.length > 0 ? roundPercentage(correct / evaluatedValues.length) : 0
  };
}

function engineLabel(type: PredictionType): string {
  const map: Record<PredictionType, string> = {
    fullTimeResult: "MS Motoru",
    firstHalfResult: "IY Motoru",
    halfTimeFullTime: "IY/MS Motoru",
    bothTeamsToScore: "KG Motoru",
    totalGoalsOverUnder: "Alt/Üst Motoru",
    correctScore: "Skor Motoru",
    goalRange: "Gol Aralığı Motoru",
    firstHalfGoals: "İlk Yarı Gol Motoru",
    secondHalfGoals: "İkinci Yarı Gol Motoru"
  };
  return map[type];
}

function isPredictionConsideredPlayed(item: MatchPredictionItem): boolean {
  if (isCompletedMatchStatus(item.matchStatus)) {
    return true;
  }
  if (isLiveMatchStatus(item.matchStatus)) {
    return false;
  }
  return item.isPlayed === true;
}

function sortStatsByAccuracy<T extends PredictionAccuracyStats>(rows: T[]): T[] {
  return rows.sort((left, right) => {
    if (right.accuracy !== left.accuracy) {
      return right.accuracy - left.accuracy;
    }
    if (right.evaluated !== left.evaluated) {
      return right.evaluated - left.evaluated;
    }
    return left.label.localeCompare(right.label, "tr");
  });
}

function resolveLeagueIdentity(item: MatchPredictionItem): { key: string; label: string } {
  const key = item.leagueId ?? item.leagueCode ?? item.leagueName ?? "unknown_league";
  const label = item.leagueName ?? item.leagueCode ?? "Bilinmeyen Lig";
  return { key, label };
}

export function buildPredictionPerformanceReport(items: MatchPredictionItem[]): PredictionPerformanceReport {
  const playedItems = items.filter((item) => isPredictionConsideredPlayed(item));
  const evaluations = playedItems.map((item) => ({
    item,
    result: evaluatePrediction(item)
  }));

  const evaluationResults = evaluations.map((entry) => entry.result).filter((value): value is boolean => value !== null);
  const correctPredictions = evaluationResults.filter((value) => value).length;
  const failedPredictions = evaluationResults.length - correctPredictions;

  const summary: PredictionPerformanceSummary = {
    totalPredictions: playedItems.length,
    evaluatedPredictions: evaluationResults.length,
    correctPredictions,
    failedPredictions,
    successRate: evaluationResults.length > 0 ? roundPercentage(correctPredictions / evaluationResults.length) : 0,
    uniqueMatchCount: new Set(playedItems.map((item) => item.matchId)).size
  };

  const byType = new Map<PredictionType, Array<boolean | null>>();
  const byEngine = new Map<string, Array<boolean | null>>();
  const byModel = new Map<string, Array<boolean | null>>();

  for (const { item, result } of evaluations) {
    byType.set(item.predictionType, [...(byType.get(item.predictionType) ?? []), result]);

    const engine = engineLabel(item.predictionType);
    byEngine.set(engine, [...(byEngine.get(engine) ?? []), result]);

    const model = item.modelVersionId && item.modelVersionId.length > 0 ? item.modelVersionId : "Bilinmeyen";
    byModel.set(model, [...(byModel.get(model) ?? []), result]);
  }

  const byTypeRows = Array.from(byType.entries())
    .map(([type, values]) => toStats(type, predictionTypeLabel(type), values))
    .sort((left, right) => right.accuracy - left.accuracy);

  const byEngineRows = Array.from(byEngine.entries())
    .map(([engine, values]) => toStats(engine, engine, values))
    .sort((left, right) => right.accuracy - left.accuracy);

  const byModelRows = Array.from(byModel.entries())
    .map(([model, values]) => toStats(model, model, values))
    .sort((left, right) => right.accuracy - left.accuracy);

  return {
    summary,
    byType: byTypeRows,
    byEngine: byEngineRows,
    byModel: byModelRows
  };
}

export function buildLeaguePredictionPerformanceReport(items: MatchPredictionItem[]): LeaguePredictionPerformanceReport {
  const playedItems = items.filter((item) => isPredictionConsideredPlayed(item));
  const leagueMap = new Map<
    string,
    {
      label: string;
      results: Array<{ item: MatchPredictionItem; result: boolean | null }>;
      uniqueMatchIds: Set<string>;
    }
  >();

  for (const item of playedItems) {
    const { key, label } = resolveLeagueIdentity(item);
    const result = evaluatePrediction(item);
    const existing = leagueMap.get(key) ?? { label, results: [], uniqueMatchIds: new Set<string>() };
    existing.results.push({ item, result });
    existing.uniqueMatchIds.add(item.matchId);
    leagueMap.set(key, existing);
  }

  const leagues: LeaguePerformanceRow[] = [];
  for (const [leagueKey, leagueData] of leagueMap.entries()) {
    const typeMap = new Map<PredictionType, Array<boolean | null>>();
    const evaluatedResults = leagueData.results
      .map((entry) => entry.result)
      .filter((value): value is boolean => value !== null);
    const correct = evaluatedResults.filter((value) => value).length;
    const failed = evaluatedResults.length - correct;

    for (const entry of leagueData.results) {
      const values = typeMap.get(entry.item.predictionType) ?? [];
      values.push(entry.result);
      typeMap.set(entry.item.predictionType, values);
    }

    const byType = sortStatsByAccuracy(
      Array.from(typeMap.entries()).map(([type, values]) => toStats(type, predictionTypeLabel(type), values))
    );
    const topType = byType[0];

    leagues.push({
      leagueKey,
      leagueLabel: leagueData.label,
      evaluated: evaluatedResults.length,
      correct,
      failed,
      successRate: evaluatedResults.length > 0 ? roundPercentage(correct / evaluatedResults.length) : 0,
      uniqueMatchCount: leagueData.uniqueMatchIds.size,
      topTypeLabel: topType?.label ?? "Değerlendirilebilir tür yok",
      topTypeAccuracy: topType?.accuracy ?? 0,
      byType
    });
  }

  const totalEvaluated = leagues.reduce((acc, league) => acc + league.evaluated, 0);
  const totalCorrect = leagues.reduce((acc, league) => acc + league.correct, 0);
  const totalFailed = leagues.reduce((acc, league) => acc + league.failed, 0);
  const totalUniqueMatches = leagues.reduce((acc, league) => acc + league.uniqueMatchCount, 0);

  const sortedLeagues = leagues.sort((left, right) => {
    if (right.successRate !== left.successRate) {
      return right.successRate - left.successRate;
    }
    if (right.evaluated !== left.evaluated) {
      return right.evaluated - left.evaluated;
    }
    return left.leagueLabel.localeCompare(right.leagueLabel, "tr");
  });

  return {
    summary: {
      leagueCount: sortedLeagues.length,
      evaluatedPredictions: totalEvaluated,
      correctPredictions: totalCorrect,
      failedPredictions: totalFailed,
      successRate: totalEvaluated > 0 ? roundPercentage(totalCorrect / totalEvaluated) : 0,
      uniqueMatchCount: totalUniqueMatches
    },
    leagues: sortedLeagues
  };
}
