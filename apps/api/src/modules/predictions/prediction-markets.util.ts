import { MatchStatus } from "@prisma/client";
import { normalizePublicMatchStatus } from "../matches/public-match-status.util";

type UnknownRecord = Record<string, unknown>;

type Severity = "low" | "medium" | "high" | "critical" | "unknown";
export type PredictionSourceType = "published" | "legacy" | "prediction_run_fallback" | "synthetic";

export type ApiRiskFlag = {
  code: string;
  severity: Severity;
  message: string;
};

export type MarketRefinementDiagnostics = {
  version: "market_refinement_v1";
  applied: boolean;
  marketKey: string;
  marketFamily: string;
  method: string;
  rawConfidence: number;
  adjustedConfidence: number;
  probabilityAdjustment?: Record<string, number>;
  signals: Record<string, number | string | boolean | null>;
  weights: Record<string, number>;
};

export type ExpandedPredictionItem = {
  matchId: string;
  modelVersionId?: string | null;
  sourceType?: PredictionSourceType;
  modelVersion?: string | null;
  horizon?: string | null;
  cutoffAt?: string | null;
  featureCoverage?: unknown;
  confidenceDiagnostics?: unknown;
  calibrationDiagnostics?: unknown;
  marketRefinementDiagnostics?: MarketRefinementDiagnostics;
  leagueId?: string;
  leagueName?: string;
  leagueCode?: string;
  predictionType:
    | "fullTimeResult"
    | "firstHalfResult"
    | "halfTimeFullTime"
    | "bothTeamsToScore"
    | "totalGoalsOverUnder"
    | "correctScore"
    | "goalRange"
    | "firstHalfGoals"
    | "secondHalfGoals";
  marketKey: string;
  selectionLabel?: string;
  line?: number;
  probabilities: Record<string, number>;
  expectedScore?: { home: number; away: number };
  scorelineDistribution?: Array<{ home: number; away: number; probability: number }>;
  quarterBreakdown?: {
    q1: { home: number; away: number };
    q2: { home: number; away: number };
    q3: { home: number; away: number };
    q4: { home: number; away: number };
    source: "provider_period_scores" | "projected" | "estimated_from_final_score" | "estimated_from_half_time_and_final";
  };
  commentary?: {
    shortComment: string;
    detailedComment: string;
    expertComment: string;
    confidenceNote: string;
  };
  supportingSignals: Array<{ key: string; label: string; detail?: string; value?: string }>;
  contradictionSignals: Array<{ key: string; label: string; detail?: string; value?: string }>;
  riskFlags: ApiRiskFlag[];
  fairOdds?: number | null;
  offeredOdds?: number | null;
  edge?: number | null;
  bookmaker?: string | null;
  oddsProvider?: string | null;
  marketProbability?: number | null;
  selectionScore?: number | null;
  publishScore?: number | null;
  volatilityScore?: number | null;
  providerDisagreement?: number | null;
  strategyProfile?: string | null;
  riskTier?: string | null;
  confidenceScore: number;
  summary: string;
  avoidReason: string | null;
  updatedAt: string;
  matchStatus?: string;
  homeScore?: number | null;
  awayScore?: number | null;
  halfTimeHomeScore?: number | null;
  halfTimeAwayScore?: number | null;
  isPlayed?: boolean;
  homeTeam?: string;
  awayTeam?: string;
  matchDateTimeUTC?: string;
};

export type PredictionRowInput = {
  matchId: string;
  modelVersionId?: string | null;
  sourceType?: PredictionSourceType;
  modelVersion?: string | null;
  horizon?: string | null;
  cutoffAt?: Date | string | null;
  featureCoverage?: unknown;
  confidenceDiagnostics?: unknown;
  calibrationDiagnostics?: unknown;
  probabilities: unknown;
  calibratedProbabilities: unknown;
  rawProbabilities: unknown;
  expectedScore: unknown;
  confidenceScore: number;
  summary: string;
  riskFlags: unknown;
  avoidReason: string | null;
  updatedAt: Date;
  match?: {
    homeTeam?: { name: string };
    awayTeam?: { name: string };
    league?: { id: string; name: string; code?: string | null };
    matchDateTimeUTC?: Date;
    status?: string;
    homeScore?: number | null;
    awayScore?: number | null;
    halfTimeHomeScore?: number | null;
    halfTimeAwayScore?: number | null;
    q1HomeScore?: number | null;
    q1AwayScore?: number | null;
    q2HomeScore?: number | null;
    q2AwayScore?: number | null;
    q3HomeScore?: number | null;
    q3AwayScore?: number | null;
    q4HomeScore?: number | null;
    q4AwayScore?: number | null;
  };
};

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function clampProbability(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function round4(value: number) {
  return Number(value.toFixed(4));
}

function envNumber(key: string, fallback: number) {
  const parsed = Number(process.env[key]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(key: string, fallback: boolean) {
  const raw = process.env[key];
  if (raw === undefined) {
    return fallback;
  }
  return raw === "1" || raw.toLowerCase() === "true";
}

const MARKET_REFINEMENT_CONFIG = {
  enabled: envBool("FOOTBALL_MARKET_REFINEMENT_ENABLED", true),
  correctScore: {
    entropyPenaltyWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_CORRECT_SCORE_ENTROPY_WEIGHT", 0.045),
    volatilityPenaltyWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_CORRECT_SCORE_VOLATILITY_WEIGHT", 0.025),
    maxPenalty: envNumber("FOOTBALL_MARKET_REFINEMENT_CORRECT_SCORE_MAX_PENALTY", 0.07)
  },
  halfTimeFullTime: {
    instabilityPenaltyWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_HTFT_INSTABILITY_WEIGHT", 0.055),
    maxPenalty: envNumber("FOOTBALL_MARKET_REFINEMENT_HTFT_MAX_PENALTY", 0.065)
  },
  bothTeamsToScore: {
    symmetryWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_BTTS_SYMMETRY_WEIGHT", 0.035),
    cleanSheetWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_BTTS_CLEAN_SHEET_WEIGHT", 0.05),
    maxProbabilityDelta: envNumber("FOOTBALL_MARKET_REFINEMENT_BTTS_MAX_DELTA", 0.055),
    maxConfidencePenalty: envNumber("FOOTBALL_MARKET_REFINEMENT_BTTS_MAX_CONFIDENCE_PENALTY", 0.04),
    empiricalBaseRate: envNumber("FOOTBALL_MARKET_REFINEMENT_BTTS_BASE_RATE", 0.56),
    empiricalPriorWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_BTTS_PRIOR_WEIGHT", 0.55),
    tempoPivot: envNumber("FOOTBALL_MARKET_REFINEMENT_BTTS_TEMPO_PIVOT", 2.08),
    tempoWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_BTTS_TEMPO_WEIGHT", 0.16)
  },
  overUnder: {
    tempoWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_OU_TEMPO_WEIGHT", 0.035),
    oddsAgreementWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_OU_ODDS_AGREEMENT_WEIGHT", 0.025),
    maxProbabilityDelta: envNumber("FOOTBALL_MARKET_REFINEMENT_OU_MAX_DELTA", 0.05),
    confidenceAgreementWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_OU_CONFIDENCE_AGREEMENT_WEIGHT", 0.045)
  },
  halfMarkets: {
    paceWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_HALF_PACE_WEIGHT", 0.035),
    firstHalfDrawWeight: envNumber("FOOTBALL_MARKET_REFINEMENT_FIRST_HALF_DRAW_WEIGHT", 0.025),
    maxProbabilityDelta: envNumber("FOOTBALL_MARKET_REFINEMENT_HALF_MAX_DELTA", 0.045),
    maxConfidencePenalty: envNumber("FOOTBALL_MARKET_REFINEMENT_HALF_MAX_CONFIDENCE_PENALTY", 0.04)
  }
};

function normalizeOutcomeProbabilities(raw: unknown) {
  const record = asRecord(raw);
  const home = asNumber(record?.home);
  const draw = asNumber(record?.draw);
  const away = asNumber(record?.away);
  if (home === undefined || draw === undefined || away === undefined) {
    return null;
  }

  const safeHome = clampProbability(home);
  const safeDraw = clampProbability(draw);
  const safeAway = clampProbability(away);
  const sum = safeHome + safeDraw + safeAway;
  if (sum <= 0) {
    return null;
  }
  return {
    home: round4(safeHome / sum),
    draw: round4(safeDraw / sum),
    away: round4(safeAway / sum)
  };
}

function normalizeRiskFlags(raw: unknown): ApiRiskFlag[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }
      const code = typeof record.code === "string" && record.code.trim().length > 0 ? record.code : "UNKNOWN_RISK";
      const message =
        typeof record.message === "string" && record.message.trim().length > 0
          ? record.message
          : "Tahmin varyansı artmış olabilir.";
      const severityRaw = typeof record.severity === "string" ? record.severity.toLowerCase() : "unknown";
      const severity: Severity =
        severityRaw === "low" || severityRaw === "medium" || severityRaw === "high" || severityRaw === "critical"
          ? (severityRaw as Severity)
          : "unknown";
      return { code, severity, message };
    })
    .filter((item): item is ApiRiskFlag => item !== null);
}

function normalizeExpectedScore(raw: unknown, fallbackHome = 1.35, fallbackAway = 1.05) {
  const record = asRecord(raw);
  const home = asNumber(record?.home) ?? fallbackHome;
  const away = asNumber(record?.away) ?? fallbackAway;
  return {
    home: Math.max(0.15, home),
    away: Math.max(0.15, away)
  };
}

function factorial(value: number) {
  if (value <= 1) {
    return 1;
  }
  let result = 1;
  for (let i = 2; i <= value; i += 1) {
    result *= i;
  }
  return result;
}

function poissonPmf(goals: number, lambda: number) {
  if (goals < 0) {
    return 0;
  }
  return (Math.exp(-lambda) * Math.pow(lambda, goals)) / factorial(goals);
}

function totalGoalsOverProbability(lambdaTotal: number, line: number) {
  const threshold = Math.floor(line);
  let cumulative = 0;
  for (let goals = 0; goals <= threshold; goals += 1) {
    cumulative += poissonPmf(goals, lambdaTotal);
  }
  return clampProbability(1 - cumulative);
}

function outcomeFromLambdas(homeLambda: number, awayLambda: number, maxGoals = 10) {
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let h = 0; h <= maxGoals; h += 1) {
    const hP = poissonPmf(h, homeLambda);
    for (let a = 0; a <= maxGoals; a += 1) {
      const probability = hP * poissonPmf(a, awayLambda);
      if (h > a) {
        home += probability;
      } else if (h === a) {
        draw += probability;
      } else {
        away += probability;
      }
    }
  }
  const sum = home + draw + away;
  return {
    home: round4(home / sum),
    draw: round4(draw / sum),
    away: round4(away / sum)
  };
}

function correctScoreDistribution(homeLambda: number, awayLambda: number, maxGoals = 6) {
  const distribution: Array<{ home: number; away: number; probability: number }> = [];
  for (let h = 0; h <= maxGoals; h += 1) {
    for (let a = 0; a <= maxGoals; a += 1) {
      distribution.push({
        home: h,
        away: a,
        probability: poissonPmf(h, homeLambda) * poissonPmf(a, awayLambda)
      });
    }
  }
  const sorted = distribution.sort((left, right) => right.probability - left.probability).slice(0, 12);
  const sum = sorted.reduce((acc, item) => acc + item.probability, 0) || 1;
  return sorted.map((item) => ({
    home: item.home,
    away: item.away,
    probability: round4(item.probability / sum)
  }));
}

function outcomeSignalLabel(probabilities: { home: number; draw: number; away: number }) {
  const entries = [
    { key: "home", value: probabilities.home, label: "Ev sahibi üstün" },
    { key: "draw", value: probabilities.draw, label: "Dengeli maç" },
    { key: "away", value: probabilities.away, label: "Deplasman üstün" }
  ].sort((left, right) => right.value - left.value);
  return entries[0]?.label ?? "Denge";
}

function confidenceNote(confidenceScore: number, riskFlags: ApiRiskFlag[]) {
  if (confidenceScore >= 0.72 && riskFlags.length === 0) {
    return "Model güven skoru yüksek. Yine de maç içi gelişmeler sonucu etkileyebilir.";
  }
  if (confidenceScore >= 0.58) {
    return "Model güven skoru orta seviyede. Tahmini diğer sinyallerle birlikte değerlendirin.";
  }
  return "Model güven skoru düşük. Bu tahmin tek başına karar için yeterli görülmemeli.";
}

function buildCommentary(
  homeTeam: string,
  awayTeam: string,
  probabilities: { home: number; draw: number; away: number },
  confidenceScore: number,
  riskFlags: ApiRiskFlag[]
) {
  const shortComment = `${homeTeam} - ${awayTeam} maçında öne çıkan senaryo: ${outcomeSignalLabel(probabilities)}.`;
  const detailedComment = `Ev: %${Math.round(probabilities.home * 100)}, Beraberlik: %${Math.round(
    probabilities.draw * 100
  )}, Dep: %${Math.round(probabilities.away * 100)} olasılık dağılımı hesaplandı.`;
  const expertComment =
    riskFlags.length > 0
      ? `Risk bayrakları nedeniyle varyans artabilir (${riskFlags.map((item) => item.code).join(", ")}).`
      : "Ekstra risk bayrağı görünmüyor, model sinyalleri kendi içinde tutarlı.";

  return {
    shortComment,
    detailedComment,
    expertComment,
    confidenceNote: confidenceNote(confidenceScore, riskFlags)
  };
}

function normalizePair(valueHome: number, valueAway: number) {
  const safeHome = Math.max(0, valueHome);
  const safeAway = Math.max(0, valueAway);
  return {
    home: round4(safeHome),
    away: round4(safeAway)
  };
}

function effectiveMatchStatus(statusRaw: string | undefined, kickoffAt: Date | undefined, homeScore: number | null | undefined, awayScore: number | null | undefined) {
  const kickoff = kickoffAt instanceof Date && Number.isFinite(kickoffAt.getTime()) ? kickoffAt : new Date(Date.now());
  const status = (statusRaw ?? "").toLowerCase();
  const normalized =
    status === MatchStatus.live ||
    status === MatchStatus.finished ||
    status === MatchStatus.postponed ||
    status === MatchStatus.cancelled ||
    status === MatchStatus.scheduled
      ? (status as MatchStatus)
      : MatchStatus.scheduled;
  return normalizePublicMatchStatus({
    status: normalized,
    matchDateTimeUTC: kickoff,
    homeScore,
    awayScore
  });
}

function createHalfTimeFullTimeProbabilities(
  firstHalf: { home: number; draw: number; away: number },
  fullTime: { home: number; draw: number; away: number }
) {
  const raw = {
    HH: firstHalf.home * fullTime.home,
    HD: firstHalf.home * fullTime.draw,
    HA: firstHalf.home * fullTime.away,
    DH: firstHalf.draw * fullTime.home,
    DD: firstHalf.draw * fullTime.draw,
    DA: firstHalf.draw * fullTime.away,
    AH: firstHalf.away * fullTime.home,
    AD: firstHalf.away * fullTime.draw,
    AA: firstHalf.away * fullTime.away
  };
  const sum = Object.values(raw).reduce((acc, item) => acc + item, 0) || 1;
  return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, round4(value / sum)]));
}

function normalizedEntropy(values: number[]) {
  const safeValues = values.map(clampProbability);
  const sum = safeValues.reduce((acc, item) => acc + item, 0);
  if (safeValues.length <= 1 || sum <= 0) {
    return 0;
  }
  const entropy = safeValues.reduce((acc, item) => {
    const probability = item / sum;
    return probability > 0 ? acc - probability * Math.log(probability) : acc;
  }, 0);
  return clampProbability(entropy / Math.log(safeValues.length));
}

function topProbabilityMargin(values: number[]) {
  const sorted = values.map(clampProbability).sort((left, right) => right - left);
  return clampProbability((sorted[0] ?? 0) - (sorted[1] ?? 0));
}

function topKey(probabilities: Record<string, number>) {
  return Object.entries(probabilities).sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function normalizeProbabilityRecord(probabilities: Record<string, number>) {
  const safeEntries = Object.entries(probabilities).map(([key, value]) => [key, clampProbability(value)] as const);
  const sum = safeEntries.reduce((acc, [, value]) => acc + value, 0);
  if (sum <= 0) {
    return probabilities;
  }
  return Object.fromEntries(safeEntries.map(([key, value]) => [key, round4(value / sum)]));
}

function agreementLevelToScore(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.toLowerCase();
  if (normalized === "high" || normalized === "strong") {
    return 0.8;
  }
  if (normalized === "medium" || normalized === "moderate") {
    return 0.55;
  }
  if (normalized === "low" || normalized === "weak") {
    return 0.3;
  }
  return undefined;
}

function extractNestedNumber(records: Array<UnknownRecord | null>, keys: string[]) {
  for (const record of records) {
    if (!record) {
      continue;
    }
    for (const key of keys) {
      const value = asNumber(record[key]);
      if (value !== undefined) {
        return clampProbability(value);
      }
    }
  }
  return undefined;
}

function extractVolatilityScore(row: PredictionRowInput, riskFlags: ApiRiskFlag[], totalLambda: number) {
  const expectedScoreRecord = asRecord(row.expectedScore);
  const confidenceRecord = asRecord(row.confidenceDiagnostics);
  const calibrationRecord = asRecord(row.calibrationDiagnostics);
  const explicit = extractNestedNumber([expectedScoreRecord, confidenceRecord, calibrationRecord], [
    "volatility",
    "volatilityScore",
    "lambdaVolatility",
    "marketVolatility"
  ]);
  if (explicit !== undefined) {
    return explicit;
  }
  const riskFlagVolatility = riskFlags.some((flag) =>
    flag.code.includes("VOLATILITY") || flag.code.includes("VARIANCE") || flag.code.includes("UNSTABLE")
  )
    ? 0.72
    : 0;
  const goalEnvironmentVolatility = clampProbability((totalLambda - 1.8) / 2.6);
  return Math.max(riskFlagVolatility, goalEnvironmentVolatility);
}

function extractOddsAgreement(row: PredictionRowInput) {
  const expectedScoreRecord = asRecord(row.expectedScore);
  const confidenceRecord = asRecord(row.confidenceDiagnostics);
  const calibrationRecord = asRecord(row.calibrationDiagnostics);
  const explicit = extractNestedNumber([expectedScoreRecord, confidenceRecord, calibrationRecord], [
    "marketCoverageScore",
    "marketAgreementScore",
    "oddsAgreement",
    "providerAgreement",
    "consensusScore"
  ]);
  if (explicit !== undefined) {
    return explicit;
  }
  return agreementLevelToScore(expectedScoreRecord?.marketAgreementLevel) ?? 0.5;
}

function buildMarketRefinementDiagnostics(params: {
  marketKey: string;
  marketFamily: string;
  method: string;
  rawConfidence: number;
  adjustedConfidence: number;
  probabilityAdjustment?: Record<string, number>;
  signals: Record<string, number | string | boolean | null>;
  weights: Record<string, number>;
}): MarketRefinementDiagnostics {
  return {
    version: "market_refinement_v1",
    applied: MARKET_REFINEMENT_CONFIG.enabled,
    marketKey: params.marketKey,
    marketFamily: params.marketFamily,
    method: params.method,
    rawConfidence: round4(params.rawConfidence),
    adjustedConfidence: round4(params.adjustedConfidence),
    probabilityAdjustment: params.probabilityAdjustment,
    signals: params.signals,
    weights: params.weights
  };
}

function disabledRefinement(marketKey: string, marketFamily: string, rawConfidence: number): MarketRefinementDiagnostics {
  return buildMarketRefinementDiagnostics({
    marketKey,
    marketFamily,
    method: "disabled",
    rawConfidence,
    adjustedConfidence: rawConfidence,
    signals: {},
    weights: {}
  });
}

function refineCorrectScoreMarket(
  correctScore: Array<{ home: number; away: number; probability: number }>,
  totalLambda: number,
  volatilityScore: number,
  rawConfidence: number
) {
  if (!MARKET_REFINEMENT_CONFIG.enabled) {
    return { confidenceScore: rawConfidence, diagnostics: disabledRefinement("correct_score", "correct_score", rawConfidence) };
  }
  const probabilities = correctScore.map((item) => item.probability);
  const entropy = normalizedEntropy(probabilities);
  const margin = topProbabilityMargin(probabilities);
  const lambdaVolatility = clampProbability((totalLambda - 1.8) / 2.6);
  const volatility = Math.max(volatilityScore, lambdaVolatility, 1 - margin);
  const config = MARKET_REFINEMENT_CONFIG.correctScore;
  const penalty = Math.min(
    config.maxPenalty,
    entropy * config.entropyPenaltyWeight + volatility * config.volatilityPenaltyWeight
  );
  const adjustedConfidence = round4(Math.max(0.3, rawConfidence - penalty));
  return {
    confidenceScore: adjustedConfidence,
    diagnostics: buildMarketRefinementDiagnostics({
      marketKey: "correct_score",
      marketFamily: "correct_score",
      method: "entropy_volatility_penalty",
      rawConfidence,
      adjustedConfidence,
      signals: {
        entropy: round4(entropy),
        volatility: round4(volatility),
        topProbabilityMargin: round4(margin),
        totalLambda: round4(totalLambda)
      },
      weights: {
        entropyPenaltyWeight: config.entropyPenaltyWeight,
        volatilityPenaltyWeight: config.volatilityPenaltyWeight,
        maxPenalty: config.maxPenalty
      }
    })
  };
}

function refineHalfTimeFullTimeMarket(
  firstHalf: { home: number; draw: number; away: number },
  fullTime: { home: number; draw: number; away: number },
  rawConfidence: number
) {
  if (!MARKET_REFINEMENT_CONFIG.enabled) {
    return { confidenceScore: rawConfidence, diagnostics: disabledRefinement("half_time_full_time", "half_time_full_time", rawConfidence) };
  }
  const firstHalfEntropy = normalizedEntropy([firstHalf.home, firstHalf.draw, firstHalf.away]);
  const fullTimeEntropy = normalizedEntropy([fullTime.home, fullTime.draw, fullTime.away]);
  const leaderMismatch = topKey(firstHalf) !== topKey(fullTime) ? 1 : 0;
  const instability = clampProbability(firstHalfEntropy * 0.45 + fullTimeEntropy * 0.35 + leaderMismatch * 0.2);
  const config = MARKET_REFINEMENT_CONFIG.halfTimeFullTime;
  const penalty = Math.min(config.maxPenalty, instability * config.instabilityPenaltyWeight);
  const adjustedConfidence = round4(Math.max(0.3, rawConfidence - penalty));
  return {
    confidenceScore: adjustedConfidence,
    diagnostics: buildMarketRefinementDiagnostics({
      marketKey: "half_time_full_time",
      marketFamily: "half_time_full_time",
      method: "instability_penalty",
      rawConfidence,
      adjustedConfidence,
      signals: {
        firstHalfEntropy: round4(firstHalfEntropy),
        fullTimeEntropy: round4(fullTimeEntropy),
        leaderMismatch: leaderMismatch === 1,
        instability: round4(instability)
      },
      weights: {
        instabilityPenaltyWeight: config.instabilityPenaltyWeight,
        maxPenalty: config.maxPenalty
      }
    })
  };
}

function refineBttsMarket(homeLambda: number, awayLambda: number, rawYes: number, rawConfidence: number) {
  if (!MARKET_REFINEMENT_CONFIG.enabled) {
    return {
      yes: rawYes,
      no: clampProbability(1 - rawYes),
      confidenceScore: rawConfidence,
      diagnostics: disabledRefinement("both_teams_to_score", "both_teams_to_score", rawConfidence)
    };
  }
  const totalLambda = homeLambda + awayLambda;
  const symmetry = clampProbability(1 - Math.abs(homeLambda - awayLambda) / Math.max(totalLambda, 1));
  const cleanSheetSensitivity = clampProbability((Math.exp(-homeLambda) + Math.exp(-awayLambda)) / 2);
  const ambiguity = 1 - Math.abs(rawYes - 0.5) * 2;
  const config = MARKET_REFINEMENT_CONFIG.bothTeamsToScore;
  const rawDelta =
    (symmetry - 0.5) * config.symmetryWeight - cleanSheetSensitivity * config.cleanSheetWeight;
  const delta = clamp(rawDelta, -config.maxProbabilityDelta, config.maxProbabilityDelta);
  const yes = clampProbability(rawYes + delta);
  const probabilities = normalizeProbabilityRecord({ yes, no: 1 - yes });
  const confidencePenalty = Math.min(
    config.maxConfidencePenalty,
    cleanSheetSensitivity * 0.025 + ambiguity * 0.015
  );
  const adjustedConfidence = round4(Math.max(0.35, rawConfidence - confidencePenalty));
  return {
    yes: probabilities.yes,
    no: probabilities.no,
    confidenceScore: adjustedConfidence,
    diagnostics: buildMarketRefinementDiagnostics({
      marketKey: "both_teams_to_score",
      marketFamily: "both_teams_to_score",
      method: "symmetry_clean_sheet_adjustment",
      rawConfidence,
      adjustedConfidence,
      probabilityAdjustment: { yesDelta: round4(probabilities.yes - rawYes) },
      signals: {
        symmetry: round4(symmetry),
        cleanSheetSensitivity: round4(cleanSheetSensitivity),
        ambiguity: round4(ambiguity)
      },
      weights: {
        symmetryWeight: config.symmetryWeight,
        cleanSheetWeight: config.cleanSheetWeight,
        maxProbabilityDelta: config.maxProbabilityDelta,
        maxConfidencePenalty: config.maxConfidencePenalty
      }
    })
  };
}

function refineOverUnderMarket(
  marketKey: string,
  line: number,
  totalLambda: number,
  rawOver: number,
  rawConfidence: number,
  oddsAgreement: number
) {
  if (!MARKET_REFINEMENT_CONFIG.enabled) {
    return {
      over: rawOver,
      under: clampProbability(1 - rawOver),
      confidenceScore: rawConfidence,
      diagnostics: disabledRefinement(marketKey, "total_goals_over_under", rawConfidence)
    };
  }
  const tempoScore = clampProbability((totalLambda - 1.8) / 2);
  const lineDistance = clampProbability(Math.abs(totalLambda - line) / 1.5);
  const config = MARKET_REFINEMENT_CONFIG.overUnder;
  const rawDelta =
    (tempoScore - 0.5) * config.tempoWeight + (oddsAgreement - 0.5) * config.oddsAgreementWeight;
  const delta = clamp(rawDelta, -config.maxProbabilityDelta, config.maxProbabilityDelta);
  const probabilities = normalizeProbabilityRecord({ over: rawOver + delta, under: 1 - rawOver - delta });
  const confidenceAdjustment = (oddsAgreement - 0.5) * config.confidenceAgreementWeight + lineDistance * 0.018;
  const adjustedConfidence = round4(Math.max(0.35, clampProbability(rawConfidence + confidenceAdjustment)));
  return {
    over: probabilities.over,
    under: probabilities.under,
    confidenceScore: adjustedConfidence,
    diagnostics: buildMarketRefinementDiagnostics({
      marketKey,
      marketFamily: "total_goals_over_under",
      method: "tempo_odds_agreement_adjustment",
      rawConfidence,
      adjustedConfidence,
      probabilityAdjustment: { overDelta: round4(probabilities.over - rawOver) },
      signals: {
        tempoScore: round4(tempoScore),
        oddsAgreement: round4(oddsAgreement),
        lineDistance: round4(lineDistance),
        totalLambda: round4(totalLambda),
        line
      },
      weights: {
        tempoWeight: config.tempoWeight,
        oddsAgreementWeight: config.oddsAgreementWeight,
        maxProbabilityDelta: config.maxProbabilityDelta,
        confidenceAgreementWeight: config.confidenceAgreementWeight
      }
    })
  };
}

function refineFirstHalfResultMarket(
  probabilities: { home: number; draw: number; away: number },
  firstHalfLambdaTotal: number,
  rawConfidence: number
) {
  if (!MARKET_REFINEMENT_CONFIG.enabled) {
    return {
      probabilities,
      confidenceScore: rawConfidence,
      diagnostics: disabledRefinement("first_half_outcome", "first_half", rawConfidence)
    };
  }
  const paceScore = clampProbability(firstHalfLambdaTotal / 1.2);
  const entropy = normalizedEntropy([probabilities.home, probabilities.draw, probabilities.away]);
  const config = MARKET_REFINEMENT_CONFIG.halfMarkets;
  const drawDelta = clamp((0.5 - paceScore) * config.firstHalfDrawWeight, -config.maxProbabilityDelta, config.maxProbabilityDelta);
  const nonDrawShare = Math.max(0.0001, probabilities.home + probabilities.away);
  const adjusted = normalizeProbabilityRecord({
    home: probabilities.home - drawDelta * (probabilities.home / nonDrawShare),
    draw: probabilities.draw + drawDelta,
    away: probabilities.away - drawDelta * (probabilities.away / nonDrawShare)
  }) as { home: number; draw: number; away: number };
  const confidencePenalty = Math.min(config.maxConfidencePenalty, entropy * 0.018 + Math.abs(0.5 - paceScore) * 0.012);
  const adjustedConfidence = round4(Math.max(0.32, rawConfidence - confidencePenalty));
  return {
    probabilities: adjusted,
    confidenceScore: adjustedConfidence,
    diagnostics: buildMarketRefinementDiagnostics({
      marketKey: "first_half_outcome",
      marketFamily: "first_half",
      method: "half_specific_pace_adjustment",
      rawConfidence,
      adjustedConfidence,
      probabilityAdjustment: { drawDelta: round4(adjusted.draw - probabilities.draw) },
      signals: {
        paceScore: round4(paceScore),
        entropy: round4(entropy),
        firstHalfLambdaTotal: round4(firstHalfLambdaTotal)
      },
      weights: {
        firstHalfDrawWeight: config.firstHalfDrawWeight,
        maxProbabilityDelta: config.maxProbabilityDelta,
        maxConfidencePenalty: config.maxConfidencePenalty
      }
    })
  };
}

function refineHalfGoalsMarket(
  marketKey: string,
  marketFamily: "first_half" | "second_half",
  halfLambdaTotal: number,
  baselineLambda: number,
  rawOver: number,
  rawConfidence: number
) {
  if (!MARKET_REFINEMENT_CONFIG.enabled) {
    return {
      over: rawOver,
      under: clampProbability(1 - rawOver),
      confidenceScore: rawConfidence,
      diagnostics: disabledRefinement(marketKey, marketFamily, rawConfidence)
    };
  }
  const paceScore = clampProbability(halfLambdaTotal / baselineLambda);
  const config = MARKET_REFINEMENT_CONFIG.halfMarkets;
  const delta = clamp((paceScore - 0.5) * config.paceWeight, -config.maxProbabilityDelta, config.maxProbabilityDelta);
  const probabilities = normalizeProbabilityRecord({ over: rawOver + delta, under: 1 - rawOver - delta });
  const confidencePenalty = Math.min(config.maxConfidencePenalty, Math.abs(0.5 - paceScore) * 0.014);
  const adjustedConfidence = round4(Math.max(0.33, rawConfidence - confidencePenalty));
  return {
    over: probabilities.over,
    under: probabilities.under,
    confidenceScore: adjustedConfidence,
    diagnostics: buildMarketRefinementDiagnostics({
      marketKey,
      marketFamily,
      method: "half_specific_pace_adjustment",
      rawConfidence,
      adjustedConfidence,
      probabilityAdjustment: { overDelta: round4(probabilities.over - rawOver) },
      signals: {
        paceScore: round4(paceScore),
        halfLambdaTotal: round4(halfLambdaTotal),
        baselineLambda
      },
      weights: {
        paceWeight: config.paceWeight,
        maxProbabilityDelta: config.maxProbabilityDelta,
        maxConfidencePenalty: config.maxConfidencePenalty
      }
    })
  };
}

export function expandPredictionMarkets(row: PredictionRowInput): ExpandedPredictionItem[] {
  const baseOutcome =
    normalizeOutcomeProbabilities(row.probabilities) ??
    normalizeOutcomeProbabilities(row.calibratedProbabilities) ??
    normalizeOutcomeProbabilities(row.rawProbabilities) ?? {
      home: 0.34,
      draw: 0.32,
      away: 0.34
    };

  const expectedScore = normalizeExpectedScore(row.expectedScore);
  const totalLambda = expectedScore.home + expectedScore.away;
  const firstHalfLambdaHome = expectedScore.home * 0.46;
  const firstHalfLambdaAway = expectedScore.away * 0.46;
  const secondHalfLambdaHome = Math.max(0.1, expectedScore.home - firstHalfLambdaHome);
  const secondHalfLambdaAway = Math.max(0.1, expectedScore.away - firstHalfLambdaAway);
  const firstHalfOutcome = outcomeFromLambdas(firstHalfLambdaHome, firstHalfLambdaAway);
  const riskFlags = normalizeRiskFlags(row.riskFlags);
  const confidence = clampProbability(row.confidenceScore);
  const volatilityScore = extractVolatilityScore(row, riskFlags, totalLambda);
  const oddsAgreement = extractOddsAgreement(row);
  const rawBttsYes = clampProbability((1 - Math.exp(-expectedScore.home)) * (1 - Math.exp(-expectedScore.away)));
  const outcomeImbalance = Math.abs(baseOutcome.home - baseOutcome.away);
  const balanceMultiplier = Math.max(0.75, 1 - Math.min(0.25, outcomeImbalance * 0.45));
  const bttsConfig = MARKET_REFINEMENT_CONFIG.bothTeamsToScore;
  const bothTeamsViability = clampProbability(Math.min(expectedScore.home, expectedScore.away) / 0.9);
  const tempoViability = clampProbability((totalLambda - 1.65) / 0.75);
  const empiricalPriorWeight = bttsConfig.empiricalPriorWeight * bothTeamsViability * tempoViability;
  const empiricalPrior = clampProbability(bttsConfig.empiricalBaseRate);
  const tempoLift = clamp((totalLambda - bttsConfig.tempoPivot) * bttsConfig.tempoWeight, -0.035, 0.065);
  const structuralBttsYes = clampProbability(rawBttsYes * balanceMultiplier + tempoLift);
  const bttsYes = clampProbability(
    structuralBttsYes * (1 - empiricalPriorWeight) + empiricalPrior * empiricalPriorWeight
  );
  const refinedBtts = refineBttsMarket(
    expectedScore.home,
    expectedScore.away,
    bttsYes,
    round4(Math.max(0.35, confidence - 0.02))
  );

  const homeTeam = row.match?.homeTeam?.name ?? "Ev Sahibi";
  const awayTeam = row.match?.awayTeam?.name ?? "Deplasman";
  const summary =
    row.summary && row.summary.trim().length > 0
      ? row.summary
      : `${homeTeam} - ${awayTeam}: Ev %${Math.round(baseOutcome.home * 100)}, Ber. %${Math.round(
          baseOutcome.draw * 100
        )}, Dep. %${Math.round(baseOutcome.away * 100)}.`;
  const sharedCommentary = buildCommentary(homeTeam, awayTeam, baseOutcome, confidence, riskFlags);
  const supportingSignals = [
    { key: "expected_goals", label: "Beklenen Gol Seviyesi", value: totalLambda.toFixed(2) },
    { key: "model_confidence", label: "Model Güven Skoru", value: `${Math.round(confidence * 100)}%` }
  ];
  const contradictionSignals =
    riskFlags.length > 0
      ? riskFlags.map((flag, index) => ({
          key: `risk_${index}`,
          label: flag.code,
          detail: flag.message
        }))
      : [];

  const kickoffAt = row.match?.matchDateTimeUTC;
  const effectiveStatus = effectiveMatchStatus(row.match?.status, kickoffAt, row.match?.homeScore, row.match?.awayScore);
  const hasFinalScore = row.match?.homeScore !== null && row.match?.homeScore !== undefined && row.match?.awayScore !== null && row.match?.awayScore !== undefined;
  const kickoffMs = kickoffAt?.getTime();
  const playedByScoreAndTime =
    hasFinalScore &&
    effectiveStatus !== "live" &&
    kickoffMs !== undefined &&
    kickoffMs <= Date.now() + 2 * 60 * 60 * 1000;

  const baseItem: Omit<ExpandedPredictionItem, "predictionType" | "marketKey" | "probabilities"> = {
    matchId: row.matchId,
    modelVersionId: row.modelVersionId ?? null,
    sourceType: row.sourceType,
    modelVersion: row.modelVersion ?? row.modelVersionId ?? null,
    horizon: row.horizon ?? null,
    cutoffAt:
      row.cutoffAt instanceof Date
        ? row.cutoffAt.toISOString()
        : typeof row.cutoffAt === "string"
          ? row.cutoffAt
          : null,
    featureCoverage: row.featureCoverage ?? null,
    confidenceDiagnostics: row.confidenceDiagnostics ?? null,
    calibrationDiagnostics: row.calibrationDiagnostics ?? null,
    expectedScore: normalizePair(expectedScore.home, expectedScore.away),
    commentary: sharedCommentary,
    supportingSignals,
    contradictionSignals,
    riskFlags,
    confidenceScore: round4(confidence),
    summary,
    avoidReason: row.avoidReason,
    updatedAt: row.updatedAt.toISOString(),
    matchStatus: effectiveStatus,
    homeScore: row.match?.homeScore ?? null,
    awayScore: row.match?.awayScore ?? null,
    halfTimeHomeScore: row.match?.halfTimeHomeScore ?? null,
    halfTimeAwayScore: row.match?.halfTimeAwayScore ?? null,
    isPlayed: effectiveStatus === "finished" || playedByScoreAndTime,
    leagueId: row.match?.league?.id,
    leagueName: row.match?.league?.name,
    leagueCode: row.match?.league?.code ?? undefined,
    homeTeam: row.match?.homeTeam?.name,
    awayTeam: row.match?.awayTeam?.name,
    matchDateTimeUTC: row.match?.matchDateTimeUTC?.toISOString()
  };

  const lines = [1.5, 2.5, 3.5];
  const overUnderItems: ExpandedPredictionItem[] = lines.map((line) => {
    const over = totalGoalsOverProbability(totalLambda, line);
    const refined = refineOverUnderMarket(
      `over_under_${line}`,
      line,
      totalLambda,
      over,
      round4(Math.max(0.35, confidence - 0.03)),
      oddsAgreement
    );
    return {
      ...baseItem,
      predictionType: "totalGoalsOverUnder",
      marketKey: `over_under_${line}`,
      selectionLabel: `MS ${line.toFixed(1)} Alt/Üst`,
      line,
      probabilities: {
        over: refined.over,
        under: refined.under
      },
      confidenceScore: refined.confidenceScore,
      marketRefinementDiagnostics: refined.diagnostics
    };
  });

  const firstHalfOver = totalGoalsOverProbability(firstHalfLambdaHome + firstHalfLambdaAway, 0.5);
  const secondHalfOver = totalGoalsOverProbability(secondHalfLambdaHome + secondHalfLambdaAway, 0.5);

  const matrix = createHalfTimeFullTimeProbabilities(firstHalfOutcome, baseOutcome);
  const correctScore = correctScoreDistribution(expectedScore.home, expectedScore.away);
  const refinedFirstHalfResult = refineFirstHalfResultMarket(
    firstHalfOutcome,
    firstHalfLambdaHome + firstHalfLambdaAway,
    round4(Math.max(0.32, confidence - 0.05))
  );
  const refinedHalfTimeFullTime = refineHalfTimeFullTimeMarket(
    refinedFirstHalfResult.probabilities,
    baseOutcome,
    round4(Math.max(0.3, confidence - 0.08))
  );
  const refinedCorrectScore = refineCorrectScoreMarket(
    correctScore,
    totalLambda,
    volatilityScore,
    round4(Math.max(0.3, confidence - 0.12))
  );
  const refinedFirstHalfGoals = refineHalfGoalsMarket(
    "first_half_goals",
    "first_half",
    firstHalfLambdaHome + firstHalfLambdaAway,
    1.1,
    firstHalfOver,
    round4(Math.max(0.33, confidence - 0.06))
  );
  const refinedSecondHalfGoals = refineHalfGoalsMarket(
    "second_half_goals",
    "second_half",
    secondHalfLambdaHome + secondHalfLambdaAway,
    1.3,
    secondHalfOver,
    round4(Math.max(0.33, confidence - 0.06))
  );
  const goalRangeProbabilities = {
    low: round4(1 - totalGoalsOverProbability(totalLambda, 1.5)),
    medium: round4(totalGoalsOverProbability(totalLambda, 1.5) - totalGoalsOverProbability(totalLambda, 3.5)),
    high: round4(totalGoalsOverProbability(totalLambda, 3.5))
  };

  return [
    {
      ...baseItem,
      predictionType: "fullTimeResult",
      marketKey: "match_outcome",
      probabilities: baseOutcome
    },
    {
      ...baseItem,
      predictionType: "firstHalfResult",
      marketKey: "first_half_outcome",
      probabilities: refinedFirstHalfResult.probabilities,
      confidenceScore: refinedFirstHalfResult.confidenceScore,
      marketRefinementDiagnostics: refinedFirstHalfResult.diagnostics
    },
    {
      ...baseItem,
      predictionType: "halfTimeFullTime",
      marketKey: "half_time_full_time",
      probabilities: matrix,
      confidenceScore: refinedHalfTimeFullTime.confidenceScore,
      marketRefinementDiagnostics: refinedHalfTimeFullTime.diagnostics
    },
    {
      ...baseItem,
      predictionType: "bothTeamsToScore",
      marketKey: "both_teams_to_score",
      probabilities: {
        yes: refinedBtts.yes,
        no: refinedBtts.no,
        bttsYes: refinedBtts.yes,
        bttsNo: refinedBtts.no
      },
      confidenceScore: refinedBtts.confidenceScore,
      marketRefinementDiagnostics: refinedBtts.diagnostics
    },
    ...overUnderItems,
    {
      ...baseItem,
      predictionType: "correctScore",
      marketKey: "correct_score",
      probabilities: {
        top: correctScore[0]?.probability ?? 0
      },
      scorelineDistribution: correctScore,
      confidenceScore: refinedCorrectScore.confidenceScore,
      marketRefinementDiagnostics: refinedCorrectScore.diagnostics
    },
    {
      ...baseItem,
      predictionType: "goalRange",
      marketKey: "goal_range",
      probabilities: goalRangeProbabilities,
      confidenceScore: round4(Math.max(0.32, confidence - 0.08))
    },
    {
      ...baseItem,
      predictionType: "firstHalfGoals",
      marketKey: "first_half_goals",
      selectionLabel: "1Y 0.5 Alt/Üst",
      line: 0.5,
      probabilities: {
        over: refinedFirstHalfGoals.over,
        under: refinedFirstHalfGoals.under
      },
      confidenceScore: refinedFirstHalfGoals.confidenceScore,
      marketRefinementDiagnostics: refinedFirstHalfGoals.diagnostics
    },
    {
      ...baseItem,
      predictionType: "secondHalfGoals",
      marketKey: "second_half_goals",
      selectionLabel: "2Y 0.5 Alt/Üst",
      line: 0.5,
      probabilities: {
        over: refinedSecondHalfGoals.over,
        under: refinedSecondHalfGoals.under
      },
      confidenceScore: refinedSecondHalfGoals.confidenceScore,
      marketRefinementDiagnostics: refinedSecondHalfGoals.diagnostics
    }
  ];
}
