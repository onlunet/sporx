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

const COMPLETED_MATCH_STATUSES = new Set([
  "finished",
  "ft",
  "full_time",
  "fulltime",
  "after_extra_time",
  "after_penalties",
  "ended",
  "completed"
]);

const LIVE_MATCH_STATUSES = new Set([
  "live",
  "in_play",
  "inplay",
  "playing",
  "ongoing",
  "paused",
  "first_half",
  "second_half",
  "halftime",
  "extra_time",
  "penalties"
]);

export function normalizeMatchStatus(value?: string): string {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replaceAll("-", "_")
    .replaceAll(" ", "_");
}

export function isCompletedMatchStatus(value?: string): boolean {
  const normalized = normalizeMatchStatus(value);
  return normalized.length > 0 && COMPLETED_MATCH_STATUSES.has(normalized);
}

export function isLiveMatchStatus(value?: string): boolean {
  const normalized = normalizeMatchStatus(value);
  return normalized.length > 0 && LIVE_MATCH_STATUSES.has(normalized);
}

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
  // Some providers occasionally send percentages (0-100) instead of ratios (0-1).
  const normalized = value > 1 && value <= 100 ? value / 100 : value;
  return Math.max(0, Math.min(1, normalized));
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

function normalizeExpectedScore(raw: unknown) {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }

  const home = asNumber(record.home);
  const away = asNumber(record.away);
  const expectedPossessions = asNumber(record.expectedPossessions);
  const expectedTotal = asNumber(record.expectedTotal);
  const expectedSpreadHome = asNumber(record.expectedSpreadHome);
  const firstHalfTotal = asNumber(record.firstHalfTotal);
  const secondHalfTotal = asNumber(record.secondHalfTotal);
  const paceBucket = asString(record.paceBucket);
  const marketAgreementLevel = asString(record.marketAgreementLevel);
  const marketCoverageScore = asNumber(record.marketCoverageScore);

  const rawLines = Array.isArray(record.totalLines) ? record.totalLines : [];
  const totalLines = rawLines
    .map((row) => {
      const lineRecord = asRecord(row);
      if (!lineRecord) {
        return null;
      }
      const line = asNumber(lineRecord.line);
      const over = sanitizeProbability(asNumber(lineRecord.over));
      const under = sanitizeProbability(asNumber(lineRecord.under));
      if (line === undefined || over === undefined || under === undefined) {
        return null;
      }
      return {
        line: Number(line.toFixed(2)),
        over: Number(over.toFixed(4)),
        under: Number(under.toFixed(4))
      };
    })
    .filter((row): row is { line: number; over: number; under: number } => row !== null);

  if (
    home === undefined &&
    away === undefined &&
    expectedPossessions === undefined &&
    expectedTotal === undefined &&
    expectedSpreadHome === undefined &&
    firstHalfTotal === undefined &&
    secondHalfTotal === undefined &&
    !paceBucket &&
    !marketAgreementLevel &&
    marketCoverageScore === undefined &&
    totalLines.length === 0
  ) {
    return undefined;
  }

  return {
    home,
    away,
    expectedPossessions,
    expectedTotal,
    expectedSpreadHome,
    firstHalfTotal,
    secondHalfTotal,
    paceBucket,
    marketAgreementLevel,
    marketCoverageScore,
    totalLines: totalLines.length > 0 ? totalLines : undefined
  };
}

function normalizeMarketAnalysis(raw: unknown) {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }

  const modelProbability = sanitizeProbability(asNumber(record.modelProbability));
  const marketImpliedProbability = sanitizeProbability(asNumber(record.marketImpliedProbability));
  const fairMarketProbabilityRaw = asNumber(record.fairMarketProbability);
  const fairMarketProbability =
    fairMarketProbabilityRaw === undefined ? undefined : sanitizeProbability(fairMarketProbabilityRaw) ?? null;
  const probabilityGap = asNumber(record.probabilityGap);
  const movementDirection = asString(record.movementDirection);
  const volatilityScore = asNumber(record.volatilityScore);
  const consensusScore = asNumber(record.consensusScore);
  const contradictionScore = asNumber(record.contradictionScore);
  const updatedAt = asString(record.updatedAt);
  const line = asNumber(record.line);

  if (
    modelProbability === undefined &&
    marketImpliedProbability === undefined &&
    fairMarketProbability === undefined &&
    probabilityGap === undefined &&
    !movementDirection &&
    volatilityScore === undefined &&
    consensusScore === undefined &&
    contradictionScore === undefined &&
    !updatedAt &&
    line === undefined
  ) {
    return undefined;
  }

  return {
    modelProbability,
    marketImpliedProbability,
    fairMarketProbability,
    probabilityGap,
    movementDirection,
    volatilityScore,
    consensusScore,
    contradictionScore,
    updatedAt,
    line: line ?? null
  };
}

function normalizeMovementSummary(raw: unknown) {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }
  const direction = asString(record.direction);
  const volatilityScore = asNumber(record.volatilityScore);
  if (!direction && volatilityScore === undefined) {
    return undefined;
  }
  return { direction, volatilityScore };
}

function normalizeRecommendation(raw: unknown) {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }

  const isRecommended = asBoolean(record.isRecommended);
  const primaryMarket = asString(record.primaryMarket);
  const side = asString(record.side);
  const reason = asString(record.reason);

  if (isRecommended === undefined && !primaryMarket && !side && !reason) {
    return undefined;
  }

  let normalizedPrimaryMarket: "moneyline" | "spread" | "total" | "pass" | undefined;
  if (primaryMarket === "moneyline" || primaryMarket === "spread" || primaryMarket === "total" || primaryMarket === "pass") {
    normalizedPrimaryMarket = primaryMarket;
  }

  let normalizedSide: "home" | "away" | "over" | "under" | null = null;
  if (side === "home" || side === "away" || side === "over" || side === "under") {
    normalizedSide = side;
  }

  return {
    isRecommended,
    primaryMarket: normalizedPrimaryMarket,
    side: normalizedSide,
    reason: reason ?? null
  };
}

function normalizeQuarterBreakdown(raw: unknown) {
  const record = asRecord(raw);
  if (!record) {
    return undefined;
  }

  const parseQuarter = (value: unknown) => {
    const quarter = asRecord(value);
    if (!quarter) {
      return null;
    }
    const home = asNumber(quarter.home);
    const away = asNumber(quarter.away);
    if (home === undefined || away === undefined) {
      return null;
    }
    return {
      home: Number(home.toFixed(1)),
      away: Number(away.toFixed(1))
    };
  };

  const q1 = parseQuarter(record.q1);
  const q2 = parseQuarter(record.q2);
  const q3 = parseQuarter(record.q3);
  const q4 = parseQuarter(record.q4);
  if (!q1 || !q2 || !q3 || !q4) {
    return undefined;
  }

  const sourceRaw = asString(record.source);
  const source: "provider_period_scores" | "projected" | "estimated_from_final_score" | "estimated_from_half_time_and_final" =
    sourceRaw === "provider_period_scores"
      ? "provider_period_scores"
      : sourceRaw === "estimated_from_final_score"
      ? "estimated_from_final_score"
      : sourceRaw === "estimated_from_half_time_and_final"
        ? "estimated_from_half_time_and_final"
        : "projected";

  return { q1, q2, q3, q4, source };
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
  const expectedScoreRecord = asRecord(record.expectedScore) ?? asRecord(record.projections);
  const leagueRecord = asRecord(record.league);
  const leagueId = asString(record.leagueId) ?? asString(leagueRecord?.id);
  const leagueName = asString(record.leagueName) ?? asString(leagueRecord?.name);
  const leagueCode = asString(record.leagueCode) ?? asString(leagueRecord?.code);
  const expectedScore = normalizeExpectedScore(expectedScoreRecord);

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
  const normalizedStatus = normalizeMatchStatus(matchStatus);
  const hasKnownStatus = normalizedStatus.length > 0;
  const explicitPlayed = asBoolean(record.isPlayed);

  // Keep completion strict: only explicit completion signals can mark a match as played.
  const inferredPlayed = (() => {
    if (isCompletedMatchStatus(normalizedStatus)) {
      return true;
    }
    if (isLiveMatchStatus(normalizedStatus)) {
      return false;
    }
    if (hasKnownStatus) {
      return false;
    }
    if (explicitPlayed !== undefined) {
      return explicitPlayed;
    }
    return false;
  })();

  const probabilities =
    normalizeProbabilities(record.probabilities) ??
    normalizeProbabilities(record.calibratedProbabilities) ??
    normalizeProbabilities(record.rawProbabilities);

  const directDistribution = normalizeScorelineDistribution(record.scorelineDistribution);
  const scorelineDistribution =
    directDistribution.length > 0
      ? directDistribution
      : normalizeScorelineDistribution(record.scorelineDistributionJson);
  const quarterBreakdown = normalizeQuarterBreakdown(record.quarterBreakdown);
  const marketAnalysis = normalizeMarketAnalysis(record.marketAnalysis);

  return {
    matchId,
    modelVersionId: asString(record.modelVersionId) ?? null,
    leagueId,
    leagueName,
    leagueCode,
    predictionType,
    marketKey: asString(record.marketKey),
    selectionLabel: asString(record.selectionLabel),
    line: resolveLine(record),
    probabilities,
    expectedScore,
    scorelineDistribution,
    quarterBreakdown,
    commentary: normalizeCommentary(record.commentary) ?? normalizeCommentary(record.commentaryJson),
    supportingSignals: normalizeSignals<SupportingSignal>(record.supportingSignals ?? record.supportingSignalsJson, "supporting"),
    contradictionSignals: normalizeSignals<ContradictionSignal>(
      record.contradictionSignals ?? record.contradictionSignalsJson,
      "contradiction"
    ),
    riskFlags: normalizeRiskFlags(record.riskFlags),
    marketAnalysis,
    marketAgreementLevel: asString(record.marketAgreementLevel) ?? expectedScore?.marketAgreementLevel,
    marketImpliedProbabilities: normalizeProbabilities(record.marketImpliedProbabilities),
    movementSummary: normalizeMovementSummary(record.movementSummary),
    recommendation: normalizeRecommendation(record.recommendation),
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
  const normalized = raw
    .map((item) => normalizePredictionItem(item, fallbackType))
    .filter((item): item is MatchPredictionItem => item !== null);

  const deduped = new Map<string, MatchPredictionItem>();
  for (const item of normalized) {
    const dedupeKey = [
      item.matchId,
      item.predictionType,
      item.marketKey ?? "market",
      item.selectionLabel ?? "selection",
      item.line ?? "na"
    ].join("|");

    const existing = deduped.get(dedupeKey);
    if (!existing) {
      deduped.set(dedupeKey, item);
      continue;
    }

    const existingTs = existing.updatedAt ? Date.parse(existing.updatedAt) : 0;
    const nextTs = item.updatedAt ? Date.parse(item.updatedAt) : 0;
    if (nextTs >= existingTs) {
      deduped.set(dedupeKey, item);
    }
  }

  return Array.from(deduped.values());
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
    WEATHER_VARIANCE: "Hava koşulları maç akışında sapma yaratabilir",
    LOW_LINEUP_CERTAINTY: "Muhtemel ilk 11 belirsiz",
    REFEREE_STRICTNESS: "Hakem profili kart/faul akışına etki edebilir",
    REFEREE_DATA_ESTIMATED: "Hakem verisi resmi değil, tahmini kullanılıyor",
    MARKET_DISAGREEMENT: "Model ile piyasa aynı yönde değil",
    SHARP_MOVEMENT: "Oran hareketi sert",
    STALE_ODDS: "Oran verisi güncel değil",
    LOW_ODDS_COVERAGE: "Oran kapsamı sınırlı",
    HIGH_BOOKMAKER_SPREAD: "Bookmaker farkı yüksek",
    POSSIBLE_LEAKAGE_BLOCKED: "Geç veri sızıntısı engellendi",
    UNSTABLE_MARKET_SIGNAL: "Piyasa sinyali dengesiz",
    MAJOR_LINEUP_UNCERTAINTY: "Kadro netliği düşük",
    BACK_TO_BACK_FATIGUE: "Yorgunluk sinyali var",
    OVERTIME_HANGOVER: "Uzatma sonrası performans dalgalanabilir",
    MODEL_DISAGREEMENT: "Alt modeller birbiriyle çelişiyor",
    HIGH_VOLATILITY_3PT_PROFILE: "Üç sayılık verisi yüksek oynaklık gösteriyor",
    LEAGUE_DATA_QUALITY_LOW: "Lig veri kalitesi düşük",
    SMALL_SAMPLE: "Örneklem sayısı yetersiz",
    EXTREME_MARKET_MOVEMENT: "Piyasada aşırı yön değişimi var",
    LOW_SCORE_BIAS: "Düşük skor yanlılığı etkin",
    UNSTABLE_LAMBDA: "Gol/sayı beklenti modeli kararsız",
    HIGH_VARIANCE_MATCH: "Maç oynaklığı yüksek"
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


