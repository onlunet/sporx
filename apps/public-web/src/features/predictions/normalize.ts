import {
  MatchCommentary,
  MatchPredictionGroup,
  MatchPredictionItem,
  PredictionTabKey,
  PredictionType,
  RiskFlag,
  ScorelineDistributionItem,
  SupportingSignal,
  ContradictionSignal,
  PREDICTION_TYPE_LABELS
} from "./types";

type UnknownRecord = Record<string, unknown>;

const DEFAULT_OVER_UNDER_LINES = [1.5, 2.5, 3.5];

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
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") {
      return true;
    }
    if (normalized === "false" || normalized === "0") {
      return false;
    }
  }
  return undefined;
}

function sanitizeProbability(value: number | undefined): number | undefined {
  if (value === undefined || Number.isNaN(value)) {
    return undefined;
  }
  return Math.max(0, Math.min(1, value));
}

function normalizeProbabilities(raw: unknown): Record<string, number> | undefined {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }

  const probabilities: Record<string, number> = {};
  for (const [key, value] of Object.entries(record)) {
    const numeric = sanitizeProbability(asNumber(value));
    if (numeric !== undefined) {
      probabilities[key] = numeric;
    }
  }

  return Object.keys(probabilities).length > 0 ? probabilities : undefined;
}

function normalizeRiskFlags(raw: unknown): RiskFlag[] {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => {
        const row = asRecord(item);
        if (!row) {
          return null;
        }
        const code = asString(row.code) ?? "UNKNOWN_RISK";
        const message = asString(row.message) ?? "Temkinli değerlendirme önerilir.";
        const severityRaw = asString(row.severity)?.toLowerCase();
        const severity =
          severityRaw === "low" || severityRaw === "medium" || severityRaw === "high" || severityRaw === "critical"
            ? severityRaw
            : "unknown";
        return { code, message, severity };
      })
      .filter((item): item is RiskFlag => item !== null);
  }

  const single = asRecord(raw);
  if (!single) {
    return [];
  }
  const code = asString(single.code) ?? "UNKNOWN_RISK";
  const message = asString(single.message) ?? "Temkinli değerlendirme önerilir.";
  const severityRaw = asString(single.severity)?.toLowerCase();
  const severity =
    severityRaw === "low" || severityRaw === "medium" || severityRaw === "high" || severityRaw === "critical"
      ? severityRaw
      : "unknown";
  return [{ code, message, severity }];
}

function normalizeSignals<T extends SupportingSignal | ContradictionSignal>(
  raw: unknown,
  fallbackPrefix: "supporting" | "contradiction"
): T[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item, index) => {
      if (typeof item === "string") {
        return {
          key: `${fallbackPrefix}_${index}`,
          label: item
        } as T;
      }
      const row = asRecord(item);
      if (!row) {
        return null;
      }
      const label = asString(row.label) ?? asString(row.message) ?? asString(row.key) ?? `Sinyal ${index + 1}`;
      const key = asString(row.key) ?? `${fallbackPrefix}_${index}`;
      const detail = asString(row.detail) ?? asString(row.reason) ?? asString(row.description);
      const value = asString(row.value);
      return { key, label, detail, value } as T;
    })
    .filter((item): item is T => item !== null);
}

function normalizeScorelineDistribution(raw: unknown): ScorelineDistributionItem[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((item) => {
      const row = asRecord(item);
      if (!row) {
        return null;
      }
      const home = asNumber(row.home) ?? asNumber(row.homeGoals) ?? asNumber(row.h);
      const away = asNumber(row.away) ?? asNumber(row.awayGoals) ?? asNumber(row.a);
      const probability = sanitizeProbability(
        asNumber(row.probability) ?? asNumber(row.prob) ?? asNumber(row.p)
      );
      if (home === undefined || away === undefined || probability === undefined) {
        return null;
      }
      const roundedHome = Math.max(0, Math.round(home));
      const roundedAway = Math.max(0, Math.round(away));
      return {
        home: roundedHome,
        away: roundedAway,
        probability,
        label: `${roundedHome}-${roundedAway}`
      } satisfies ScorelineDistributionItem;
    })
    .filter((item): item is ScorelineDistributionItem => item !== null)
    .sort((a, b) => b.probability - a.probability);
}

function normalizeCommentary(raw: unknown): MatchCommentary | undefined {
  if (typeof raw === "string") {
    return { shortComment: raw };
  }
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }

  const commentary: MatchCommentary = {
    shortComment: asString(record.shortComment) ?? asString(record.summary),
    detailedComment: asString(record.detailedComment) ?? asString(record.detail),
    expertComment: asString(record.expertComment) ?? asString(record.expertView),
    confidenceNote: asString(record.confidenceNote) ?? asString(record.note)
  };

  return commentary.shortComment || commentary.detailedComment || commentary.expertComment || commentary.confidenceNote
    ? commentary
    : undefined;
}

function resolvePredictionType(raw: UnknownRecord, fallbackType: PredictionType): PredictionType {
  const direct = asString(raw.predictionType);
  if (direct) {
    const key = direct as PredictionType;
    if (key in PREDICTION_TYPE_LABELS) {
      return key;
    }
  }

  const market = asString(raw.marketKey)?.toLowerCase() ?? "";
  if (market.includes("btts") || market.includes("both")) {
    return "bothTeamsToScore";
  }
  if (market.includes("over") || market.includes("under") || market.includes("goals")) {
    return "totalGoalsOverUnder";
  }
  if (market.includes("correct")) {
    return "correctScore";
  }
  if (market.includes("htft") || market.includes("iyms")) {
    return "halfTimeFullTime";
  }
  if (market.includes("first_half")) {
    return "firstHalfResult";
  }
  return fallbackType;
}

function resolveLine(raw: UnknownRecord): number | undefined {
  const directLine = asNumber(raw.line);
  if (directLine !== undefined) {
    return directLine;
  }

  const marketKey = asString(raw.marketKey) ?? "";
  const marketLineMatch = marketKey.match(/([1-5](?:\.[05])?)/);
  if (marketLineMatch) {
    return Number(marketLineMatch[1]);
  }

  const selectionLabel = asString(raw.selectionLabel) ?? "";
  const labelMatch = selectionLabel.match(/([1-5](?:\.[05])?)/);
  if (labelMatch) {
    return Number(labelMatch[1]);
  }

  return undefined;
}

export function normalizePredictionItem(raw: unknown, fallbackType: PredictionType = "fullTimeResult"): MatchPredictionItem | null {
  const record = asRecord(raw);
  if (!record) {
    return null;
  }

  const matchId = asString(record.matchId) ?? asString(record.id);
  if (!matchId) {
    return null;
  }

  const predictionType = resolvePredictionType(record, fallbackType);
  const expectedScoreRecord = asRecord(record.expectedScore);
  const expectedScore =
    expectedScoreRecord && (asNumber(expectedScoreRecord.home) !== undefined || asNumber(expectedScoreRecord.away) !== undefined)
      ? {
          home: asNumber(expectedScoreRecord.home),
          away: asNumber(expectedScoreRecord.away)
        }
      : undefined;

  const updatedAt = asString(record.updatedAt) ?? asString(record.importedAt) ?? null;
  const homeScoreRaw = asNumber(record.homeScore);
  const awayScoreRaw = asNumber(record.awayScore);
  const halfTimeHomeScoreRaw = asNumber(record.halfTimeHomeScore);
  const halfTimeAwayScoreRaw = asNumber(record.halfTimeAwayScore);
  const homeScore = homeScoreRaw === undefined ? null : Math.round(homeScoreRaw);
  const awayScore = awayScoreRaw === undefined ? null : Math.round(awayScoreRaw);
  const halfTimeHomeScore = halfTimeHomeScoreRaw === undefined ? null : Math.round(halfTimeHomeScoreRaw);
  const halfTimeAwayScore = halfTimeAwayScoreRaw === undefined ? null : Math.round(halfTimeAwayScoreRaw);
  const matchDateTimeUTC = asString(record.matchDateTimeUTC);
  const matchStatus = asString(record.matchStatus) ?? asString(record.status);
  const nowMs = Date.now();
  const kickoffMs = matchDateTimeUTC ? new Date(matchDateTimeUTC).getTime() : undefined;
  const hasScore = homeScore !== null && awayScore !== null;
  const statusLower = matchStatus?.toLowerCase();
  const explicitPlayed = asBoolean(record.isPlayed);
  const scoreSuggestsPlayed =
    hasScore && kickoffMs !== undefined && Number.isFinite(kickoffMs) && kickoffMs <= nowMs + 2 * 60 * 60 * 1000 && statusLower !== "live";
  const staleScheduledPast =
    statusLower === "scheduled" && kickoffMs !== undefined && Number.isFinite(kickoffMs) && kickoffMs <= nowMs - 3 * 60 * 60 * 1000;
  const inconsistentFutureScheduled =
    explicitPlayed === true &&
    statusLower === "scheduled" &&
    kickoffMs !== undefined &&
    Number.isFinite(kickoffMs) &&
    kickoffMs > nowMs + 2 * 60 * 60 * 1000;
  const inferredPlayed =
    explicitPlayed !== undefined
      ? inconsistentFutureScheduled
        ? false
        : explicitPlayed
      : statusLower === "finished" || scoreSuggestsPlayed || staleScheduledPast;

  const probabilities =
    normalizeProbabilities(record.probabilities) ??
    normalizeProbabilities(record.calibratedProbabilities) ??
    normalizeProbabilities(record.rawProbabilities);

  const directDistribution = normalizeScorelineDistribution(record.scorelineDistribution);
  const scorelineDistribution =
    directDistribution.length > 0
      ? directDistribution
      : normalizeScorelineDistribution(record.scorelineDistributionJson);

  return {
    matchId,
    modelVersionId: asString(record.modelVersionId) ?? null,
    predictionType,
    marketKey: asString(record.marketKey),
    selectionLabel: asString(record.selectionLabel),
    line: resolveLine(record),
    probabilities,
    expectedScore,
    scorelineDistribution,
    commentary: normalizeCommentary(record.commentary) ?? normalizeCommentary(record.commentaryJson),
    supportingSignals: normalizeSignals<SupportingSignal>(record.supportingSignals ?? record.supportingSignalsJson, "supporting"),
    contradictionSignals: normalizeSignals<ContradictionSignal>(
      record.contradictionSignals ?? record.contradictionSignalsJson,
      "contradiction"
    ),
    riskFlags: normalizeRiskFlags(record.riskFlags),
    confidenceScore: asNumber(record.confidenceScore),
    summary: asString(record.summary),
    avoidReason: (record.avoidReason as string | null | undefined) ?? null,
    updatedAt,
    matchStatus,
    homeScore,
    awayScore,
    halfTimeHomeScore,
    halfTimeAwayScore,
    isPlayed: inferredPlayed,
    homeTeam: asString(record.homeTeam),
    awayTeam: asString(record.awayTeam),
    matchDateTimeUTC
  };
}

export function normalizePredictionList(raw: unknown, fallbackType: PredictionType = "fullTimeResult"): MatchPredictionItem[] {
  if (!Array.isArray(raw)) {
    const single = normalizePredictionItem(raw, fallbackType);
    return single ? [single] : [];
  }
  return raw
    .map((item) => normalizePredictionItem(item, fallbackType))
    .filter((item): item is MatchPredictionItem => item !== null);
}

export function groupPredictionsByType(items: MatchPredictionItem[]): MatchPredictionGroup {
  const grouped: MatchPredictionGroup = {};
  for (const item of items) {
    const row = grouped[item.predictionType] ?? [];
    row.push(item);
    grouped[item.predictionType] = row;
  }
  return grouped;
}

export function filterPredictionsByType(items: MatchPredictionItem[], predictionType?: PredictionType | "all") {
  if (!predictionType || predictionType === "all") {
    return items;
  }
  return items.filter((item) => item.predictionType === predictionType);
}

export function isLowConfidence(item: MatchPredictionItem | undefined | null) {
  if (!item || item.confidenceScore === undefined) {
    return false;
  }
  return item.confidenceScore < 0.56;
}

export function bestScorelineSummary(item: MatchPredictionItem | undefined | null) {
  if (!item || !item.scorelineDistribution || item.scorelineDistribution.length === 0) {
    return null;
  }
  return item.scorelineDistribution[0];
}

export function fallbackOverUnderLines(items: MatchPredictionItem[]): MatchPredictionItem[] {
  if (items.length > 0) {
    return items
      .slice()
      .sort((a, b) => {
        const aLine = a.line ?? 99;
        const bLine = b.line ?? 99;
        return aLine - bLine;
      });
  }

  return DEFAULT_OVER_UNDER_LINES.map((line) => ({
    matchId: "synthetic",
    predictionType: "totalGoalsOverUnder",
    line,
    probabilities: undefined
  }));
}

export function predictionTypeLabel(type: PredictionType) {
  return PREDICTION_TYPE_LABELS[type];
}

export function riskCodeToTurkish(code: string) {
  const map: Record<string, string> = {
    WEATHER_VARIANCE: "Hava koşulları maç akışını oynatabilir",
    LOW_LINEUP_CERTAINTY: "Muhtemel ilk 11 belirsiz",
    REFEREE_STRICTNESS: "Hakem profili kart/foul akışını etkileyebilir",
    REFEREE_DATA_ESTIMATED: "Hakem verisi resmi değil, tahmini kullanılıyor"
  };
  return map[code] ?? code.replaceAll("_", " ").toLowerCase();
}

export function getTabAvailability(grouped: MatchPredictionGroup): Record<PredictionTabKey, boolean> {
  const has = (type: PredictionType) => (grouped[type]?.length ?? 0) > 0;
  const hasCommentary =
    Object.values(grouped)
      .flat()
      .some((item) => !!item.commentary?.shortComment || !!item.commentary?.detailedComment || !!item.commentary?.expertComment) ||
    false;

  return {
    general: has("fullTimeResult") || has("firstHalfResult") || has("totalGoalsOverUnder") || has("bothTeamsToScore"),
    firstHalfFullTime: has("firstHalfResult") || has("fullTimeResult") || has("halfTimeFullTime"),
    btts: has("bothTeamsToScore"),
    overUnder: has("totalGoalsOverUnder"),
    scoreline: has("correctScore") || Object.values(grouped).flat().some((item) => (item.scorelineDistribution?.length ?? 0) > 0),
    firstHalf: has("firstHalfGoals") || has("firstHalfResult"),
    secondHalf: has("secondHalfGoals"),
    commentary: hasCommentary
  };
}

export function nextAvailableTab(current: PredictionTabKey, availability: Record<PredictionTabKey, boolean>): PredictionTabKey {
  if (availability[current]) {
    return current;
  }
  const order: PredictionTabKey[] = [
    "general",
    "firstHalfFullTime",
    "btts",
    "overUnder",
    "scoreline",
    "firstHalf",
    "secondHalf",
    "commentary"
  ];
  return order.find((key) => availability[key]) ?? "general";
}
