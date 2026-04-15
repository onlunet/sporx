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
    const htHome = item.halfTimeHomeScore;
    const htAway = item.halfTimeAwayScore;
    if (htHome === null || htHome === undefined || htAway === null || htAway === undefined) {
      return null;
    }
    const predicted = pickTopProbability(item.probabilities, ["home", "draw", "away"]);
    if (!predicted) {
      return null;
    }
    return predicted === asOutcomeKey(htHome, htAway);
  }

  if (item.predictionType === "halfTimeFullTime") {
    const htHome = item.halfTimeHomeScore;
    const htAway = item.halfTimeAwayScore;
    if (htHome === null || htHome === undefined || htAway === null || htAway === undefined) {
      return null;
    }
    const predicted = pickTopProbability(item.probabilities, ["HH", "HD", "HA", "DH", "DD", "DA", "AH", "AD", "AA"]);
    if (!predicted) {
      return null;
    }
    const half = asOutcomeKey(htHome, htAway);
    const full = fullTimeOutcome;
    const encode = (value: "home" | "draw" | "away") => (value === "home" ? "H" : value === "draw" ? "D" : "A");
    return predicted === `${encode(half)}${encode(full)}`;
  }

  if (item.predictionType === "firstHalfGoals" || item.predictionType === "secondHalfGoals") {
    const htHome = item.halfTimeHomeScore;
    const htAway = item.halfTimeAwayScore;
    if (htHome === null || htHome === undefined || htAway === null || htAway === undefined) {
      return null;
    }
    const predicted = pickTopProbability(item.probabilities, ["over", "under"]);
    if (!predicted) {
      return null;
    }
    const line = resolveLine(item);
    const actualTotal =
      item.predictionType === "firstHalfGoals" ? htHome + htAway : Math.max(0, homeScore + awayScore - (htHome + htAway));
    const actual = actualTotal > line ? "over" : "under";
    return predicted === actual;
  }

  return null;
}

export function evaluatePredictionResult(item: MatchPredictionItem): boolean | null {
  return evaluatePrediction(item);
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
    totalGoalsOverUnder: "Alt/Ust Motoru",
    correctScore: "Skor Motoru",
    goalRange: "Gol Araligi Motoru",
    firstHalfGoals: "Ilk Yari Gol Motoru",
    secondHalfGoals: "Ikinci Yari Gol Motoru"
  };
  return map[type];
}

export function buildPredictionPerformanceReport(items: MatchPredictionItem[]): PredictionPerformanceReport {
  const playedItems = items.filter((item) => {
    if (isCompletedMatchStatus(item.matchStatus)) {
      return true;
    }
    if (isLiveMatchStatus(item.matchStatus)) {
      return false;
    }
    return item.isPlayed === true;
  });
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
