import { Injectable, Logger } from "@nestjs/common";
import { MatchStatus, Prisma, PublishDecisionStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { OddsService } from "../odds/odds.service";
import { ExpandedPredictionItem } from "./prediction-markets.util";
import { PredictionSportStrategyRegistry } from "./sport-strategies/prediction-sport-strategy.registry";
import { PipelineRolloutService } from "./pipeline-rollout.service";

type ListPredictionsParams = {
  status?: string;
  sport?: string;
  predictionType?: string;
  line?: number;
  take?: number;
  includeMarketAnalysis?: boolean;
};

type ListByMatchParams = {
  predictionType?: string;
  line?: number;
  includeMarketAnalysis?: boolean;
};

type MatchStubRecord = {
  id: string;
  matchDateTimeUTC: Date;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  halfTimeHomeScore: number | null;
  halfTimeAwayScore: number | null;
  homeElo?: number | null;
  awayElo?: number | null;
  form5Home?: number | null;
  form5Away?: number | null;
  homeTeam: { name: string };
  awayTeam: { name: string };
  league: { id: string; name: string; code: string | null } | null;
  sport: { code: string } | null;
};

const MATCH_STATUS_SET = new Set<MatchStatus>([
  MatchStatus.scheduled,
  MatchStatus.live,
  MatchStatus.finished,
  MatchStatus.postponed,
  MatchStatus.cancelled
]);

const FINAL_PUBLISH_DECISION_STATUSES: PublishDecisionStatus[] = [
  PublishDecisionStatus.APPROVED,
  PublishDecisionStatus.MANUALLY_FORCED
];

const PREDICTION_TYPE_SET = new Set([
  "fullTimeResult",
  "firstHalfResult",
  "halfTimeFullTime",
  "bothTeamsToScore",
  "totalGoalsOverUnder",
  "correctScore",
  "goalRange",
  "firstHalfGoals",
  "secondHalfGoals"
]);

function parseStatusFilter(input?: string): MatchStatus[] | undefined {
  if (!input) {
    return undefined;
  }

  const values = input
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const unique: MatchStatus[] = [];
  for (const value of values) {
    if (MATCH_STATUS_SET.has(value as MatchStatus) && !unique.includes(value as MatchStatus)) {
      unique.push(value as MatchStatus);
    }
  }

  return unique.length > 0 ? unique : undefined;
}

function parsePredictionType(input?: string): string | undefined {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim();
  return PREDICTION_TYPE_SET.has(normalized) ? normalized : undefined;
}

function parseLine(input?: number) {
  if (input === undefined) {
    return undefined;
  }
  if (!Number.isFinite(input)) {
    return undefined;
  }
  return Number(input.toFixed(2));
}

function parseTake(input: number | undefined, hasExplicitStatus: boolean) {
  const defaultTake = hasExplicitStatus ? 120 : 80;
  if (input === undefined || !Number.isFinite(input)) {
    return defaultTake;
  }
  return Math.max(1, Math.min(300, Math.trunc(input)));
}

function parseSportFilter(input?: string): "football" | "basketball" | undefined {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "football" || normalized === "soccer") {
    return "football";
  }
  if (normalized === "basketball" || normalized === "basket" || normalized === "nba") {
    return "basketball";
  }
  return undefined;
}

function safeTeamName(value: unknown, fallback: string) {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function safeLeague(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" ? record.name : "";
  const code = typeof record.code === "string" ? record.code : null;
  if (!id || !name) {
    return undefined;
  }
  return { id, name, code };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asFinite(value: unknown): number | undefined {
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

function normalizeProbabilities(
  probabilitiesRaw: unknown,
  calibratedRaw: unknown,
  rawRaw: unknown
): {
  predictionType: ExpandedPredictionItem["predictionType"];
  marketKey: string;
  probabilities: Record<string, number>;
} {
  const sources = [probabilitiesRaw, calibratedRaw, rawRaw];
  for (const source of sources) {
    const record = asRecord(source);
    if (!record) {
      continue;
    }
    const home = asFinite(record.home);
    const draw = asFinite(record.draw);
    const away = asFinite(record.away);
    if (home !== undefined && draw !== undefined && away !== undefined) {
      const sum = Math.max(0.0001, home + draw + away);
      const probabilities: Record<string, number> = {
        home: Number((home / sum).toFixed(4)),
        draw: Number((draw / sum).toFixed(4)),
        away: Number((away / sum).toFixed(4))
      };
      return {
        predictionType: "fullTimeResult" as const,
        marketKey: "fullTimeResult:1x2",
        probabilities
      };
    }

    const yes = asFinite(record.yes);
    const no = asFinite(record.no);
    if (yes !== undefined && no !== undefined) {
      const sum = Math.max(0.0001, yes + no);
      const probabilities: Record<string, number> = {
        yes: Number((yes / sum).toFixed(4)),
        no: Number((no / sum).toFixed(4))
      };
      return {
        predictionType: "bothTeamsToScore" as const,
        marketKey: "bothTeamsToScore:yes-no",
        probabilities
      };
    }

    const over = asFinite(record.over);
    const under = asFinite(record.under);
    if (over !== undefined && under !== undefined) {
      const sum = Math.max(0.0001, over + under);
      const probabilities: Record<string, number> = {
        over: Number((over / sum).toFixed(4)),
        under: Number((under / sum).toFixed(4))
      };
      return {
        predictionType: "totalGoalsOverUnder" as const,
        marketKey: "totalGoalsOverUnder:line",
        probabilities
      };
    }
  }

  const probabilities: Record<string, number> = {
    home: 0.34,
    draw: 0.33,
    away: 0.33
  };
  return {
    predictionType: "fullTimeResult" as const,
    marketKey: "fullTimeResult:1x2",
    probabilities
  };
}

function normalizeRiskFlags(raw: unknown) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((item) => {
      const record = asRecord(item);
      if (!record) {
        return null;
      }
      const code = typeof record.code === "string" && record.code.length > 0 ? record.code : "UNKNOWN";
      const message = typeof record.message === "string" && record.message.length > 0 ? record.message : "Risk sinyali";
      const severityRaw = typeof record.severity === "string" ? record.severity : "unknown";
      const severity =
        severityRaw === "low" || severityRaw === "medium" || severityRaw === "high" || severityRaw === "critical"
          ? severityRaw
          : "unknown";
      return { code, severity, message };
    })
    .filter((item): item is { code: string; severity: "low" | "medium" | "high" | "critical" | "unknown"; message: string } => Boolean(item));
}

function toMatchStatus(value: unknown): MatchStatus {
  const normalized = typeof value === "string" ? value.toLowerCase() : "";
  if (normalized === MatchStatus.live) {
    return MatchStatus.live;
  }
  if (normalized === MatchStatus.finished) {
    return MatchStatus.finished;
  }
  if (normalized === MatchStatus.postponed) {
    return MatchStatus.postponed;
  }
  if (normalized === MatchStatus.cancelled) {
    return MatchStatus.cancelled;
  }
  return MatchStatus.scheduled;
}

const PREDICTION_MATCH_SELECT = {
  status: true,
  matchDateTimeUTC: true,
  homeScore: true,
  awayScore: true,
  halfTimeHomeScore: true,
  halfTimeAwayScore: true,
  homeTeam: { select: { name: true } },
  awayTeam: { select: { name: true } },
  league: { select: { id: true, name: true, code: true } },
  sport: { select: { code: true } }
} as const;

type PublishedPredictionRecord = {
  matchId: string;
  market: string;
  line: number | null;
  lineKey: string;
  horizon: string;
  publishedAt: Date;
  predictionRun: {
    modelVersionId: string | null;
    probability: number;
    confidence: number;
    riskFlagsJson: unknown;
    explanationJson: unknown;
    createdAt: Date;
  };
  match: {
    sport: { code: string } | null;
    status: MatchStatus;
    matchDateTimeUTC: Date;
    homeScore: number | null;
    awayScore: number | null;
    halfTimeHomeScore: number | null;
    halfTimeAwayScore: number | null;
    q1HomeScore: number | null;
    q1AwayScore: number | null;
    q2HomeScore: number | null;
    q2AwayScore: number | null;
    q3HomeScore: number | null;
    q3AwayScore: number | null;
    q4HomeScore: number | null;
    q4AwayScore: number | null;
    homeTeam: { name: string };
    awayTeam: { name: string };
    league: { id: string; name: string; code: string | null } | null;
  };
};

type LegacyPredictionRecord = {
  matchId: string;
  modelVersionId: string | null;
  probabilities: unknown;
  calibratedProbabilities: unknown;
  rawProbabilities: unknown;
  expectedScore: unknown;
  confidenceScore: number;
  summary: string;
  riskFlags: unknown;
  avoidReason: string | null;
  updatedAt: Date;
  match: {
    sport: { code: string } | null;
    status: MatchStatus;
    matchDateTimeUTC: Date;
    homeScore: number | null;
    awayScore: number | null;
    halfTimeHomeScore: number | null;
    halfTimeAwayScore: number | null;
    q1HomeScore: number | null;
    q1AwayScore: number | null;
    q2HomeScore: number | null;
    q2AwayScore: number | null;
    q3HomeScore: number | null;
    q3AwayScore: number | null;
    q4HomeScore: number | null;
    q4AwayScore: number | null;
    homeTeam: { name: string };
    awayTeam: { name: string };
    league: { id: string; name: string; code: string | null } | null;
  };
};

type NormalizedPredictionRow = {
  matchId: string;
  modelVersionId: string | null;
  probabilities: unknown;
  calibratedProbabilities: unknown;
  rawProbabilities: unknown;
  expectedScore: unknown;
  confidenceScore: number;
  summary: string;
  riskFlags: unknown;
  avoidReason: string | null;
  updatedAt: Date;
  match: LegacyPredictionRecord["match"];
};

type PredictionRunFallbackRecord = {
  id: string;
  matchId: string;
  market: string;
  line: number | null;
  lineKey: string;
  horizon: string;
  modelVersionId: string | null;
  probability: number;
  confidence: number;
  riskFlagsJson: unknown;
  explanationJson: unknown;
  createdAt: Date;
  match: LegacyPredictionRecord["match"];
};

const SYNTHETIC_SUMMARY_MARKERS = [
  "yayinlanmis tahmin kaydi bulunamadigi",
  "mac verisine dayali gecici tahmin gosterimi"
];

function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSyntheticSummary(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) {
    return false;
  }
  const normalized = normalizeSearchText(value);
  return SYNTHETIC_SUMMARY_MARKERS.some((marker) => normalized.includes(marker));
}

function areLegacyRowsSyntheticOnly(rows: LegacyPredictionRecord[]): boolean {
  return rows.length > 0 && rows.every((row) => hasSyntheticSummary(row.summary));
}

function arePredictionRunRowsSyntheticOnly(rows: PredictionRunFallbackRecord[]): boolean {
  return (
    rows.length > 0 &&
    rows.every((row) => {
      const explanation = asRecord(row.explanationJson);
      const summary = typeof explanation?.summary === "string" ? explanation.summary : "";
      return hasSyntheticSummary(summary);
    })
  );
}

function isSyntheticExpandedPayload(items: unknown[]): boolean {
  if (items.length === 0) {
    return false;
  }
  let summaryCount = 0;
  let syntheticCount = 0;
  for (const item of items.slice(0, 80)) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }
    const summary = (item as Record<string, unknown>).summary;
    if (typeof summary === "string" && summary.length > 0) {
      summaryCount += 1;
      if (hasSyntheticSummary(summary)) {
        syntheticCount += 1;
      }
    }
  }
  return summaryCount > 0 && syntheticCount === summaryCount;
}

const PUBLISHED_PREDICTION_INCLUDE = {
  predictionRun: {
    select: {
      modelVersionId: true,
      probability: true,
      confidence: true,
      riskFlagsJson: true,
      explanationJson: true,
      createdAt: true
    }
  },
  match: {
    select: {
      ...PREDICTION_MATCH_SELECT,
      q1HomeScore: true,
      q1AwayScore: true,
      q2HomeScore: true,
      q2AwayScore: true,
      q3HomeScore: true,
      q3AwayScore: true,
      q4HomeScore: true,
      q4AwayScore: true
    }
  }
} as const;

const LEGACY_PREDICTION_INCLUDE = {
  match: {
    select: {
      ...PREDICTION_MATCH_SELECT,
      q1HomeScore: true,
      q1AwayScore: true,
      q2HomeScore: true,
      q2AwayScore: true,
      q3HomeScore: true,
      q3AwayScore: true,
      q4HomeScore: true,
      q4AwayScore: true
    }
  }
} as const;

const PREDICTION_RUN_FALLBACK_INCLUDE = {
  match: {
    select: {
      ...PREDICTION_MATCH_SELECT,
      q1HomeScore: true,
      q1AwayScore: true,
      q2HomeScore: true,
      q2AwayScore: true,
      q3HomeScore: true,
      q3AwayScore: true,
      q4HomeScore: true,
      q4AwayScore: true
    }
  }
} as const;

function normalizeOutcomeFromSide(side: "home" | "draw" | "away", probability: number) {
  const clamped = Math.max(0.0001, Math.min(0.9999, Number(probability.toFixed(6))));
  const rest = Math.max(0.0001, 1 - clamped);
  if (side === "home") {
    const draw = Number((rest * 0.36).toFixed(4));
    const away = Number((1 - clamped - draw).toFixed(4));
    return { home: Number(clamped.toFixed(4)), draw, away };
  }
  if (side === "draw") {
    const home = Number((rest * 0.5).toFixed(4));
    const away = Number((1 - clamped - home).toFixed(4));
    return { home, draw: Number(clamped.toFixed(4)), away };
  }
  const draw = Number((rest * 0.36).toFixed(4));
  const home = Number((1 - clamped - draw).toFixed(4));
  return { home, draw, away: Number(clamped.toFixed(4)) };
}

function fallbackProbabilitiesByMarket(
  market: string,
  probability: number,
  explanation: Record<string, unknown> | null
) {
  const selectedSideRaw = explanation && typeof explanation.selectedSide === "string" ? explanation.selectedSide : "home";
  const selectedSide =
    selectedSideRaw === "away" || selectedSideRaw === "draw" || selectedSideRaw === "home"
      ? selectedSideRaw
      : "home";
  if (market === "moneyline") {
    const clamped = Math.max(0.0001, Math.min(0.9999, Number(probability.toFixed(6))));
    const away = Number((1 - clamped).toFixed(4));
    return {
      home: Number(clamped.toFixed(4)),
      away
    };
  }
  return normalizeOutcomeFromSide(selectedSide, probability);
}

function normalizePublishedRow(row: PublishedPredictionRecord) {
  const explanation = asRecord(row.predictionRun.explanationJson);
  const probabilitiesFromExplanation = explanation ? explanation.probabilities : null;
  const calibratedFromExplanation = explanation ? explanation.calibratedProbabilities : null;
  const rawFromExplanation = explanation ? explanation.rawProbabilities : null;
  const expectedScoreFromExplanation = explanation ? explanation.expectedScore : null;
  const summaryFromExplanation = explanation && typeof explanation.summary === "string" ? explanation.summary : "";
  const avoidReasonFromExplanation =
    explanation && typeof explanation.avoidReason === "string" ? explanation.avoidReason : null;

  const fallbackProbabilities = fallbackProbabilitiesByMarket(
    row.market,
    row.predictionRun.probability,
    explanation
  );

  const probabilities = probabilitiesFromExplanation ?? calibratedFromExplanation ?? fallbackProbabilities;
  const calibratedProbabilities = calibratedFromExplanation ?? probabilities;
  const rawProbabilities = rawFromExplanation ?? probabilities;
  const expectedScore = expectedScoreFromExplanation ?? null;
  const summary =
    summaryFromExplanation.length > 0
      ? summaryFromExplanation
      : `${row.match.homeTeam.name} - ${row.match.awayTeam.name}: published ${row.market} tahmini.`;
  const summarySafe = normalizeFallbackSummary(summary, row.match, calibratedProbabilities ?? probabilities);

  return {
    matchId: row.matchId,
    modelVersionId: row.predictionRun.modelVersionId,
    probabilities,
    calibratedProbabilities,
    rawProbabilities,
    expectedScore,
    confidenceScore: row.predictionRun.confidence,
    summary: summarySafe,
    riskFlags: row.predictionRun.riskFlagsJson,
    avoidReason: avoidReasonFromExplanation,
    updatedAt: row.publishedAt ?? row.predictionRun.createdAt,
    match: row.match
  };
}

function normalizeFallbackSummary(
  summary: string,
  match: { homeTeam: { name: string }; awayTeam: { name: string } },
  probabilitySource: unknown
) {
  if (!hasSyntheticSummary(summary)) {
    return summary;
  }
  const probabilities = asRecord(probabilitySource) ?? {};
  const home = asFinite(probabilities.home);
  const draw = asFinite(probabilities.draw);
  const away = asFinite(probabilities.away);
  if (home !== undefined || draw !== undefined || away !== undefined) {
    if (draw !== undefined) {
      const homePct = Math.round((home ?? 0.34) * 100);
      const drawPct = Math.round(draw * 100);
      const awayPct = Math.round((away ?? 0.33) * 100);
      return `${match.homeTeam.name} - ${match.awayTeam.name}: model analizi Ev ${homePct}%, Beraberlik ${drawPct}%, Deplasman ${awayPct}%.`;
    }
    const homePct = Math.round((home ?? 0.5) * 100);
    const awayPct = Math.round((away ?? 0.5) * 100);
    return `${match.homeTeam.name} - ${match.awayTeam.name}: model analizi Ev ${homePct}%, Deplasman ${awayPct}%.`;
  }

  const over = asFinite(probabilities.over);
  const under = asFinite(probabilities.under);
  if (over !== undefined || under !== undefined) {
    const overPct = Math.round((over ?? 0.5) * 100);
    const underPct = Math.round((under ?? 0.5) * 100);
    return `${match.homeTeam.name} - ${match.awayTeam.name}: model analizi Üst ${overPct}%, Alt ${underPct}%.`;
  }

  const yes = asFinite(probabilities.yes) ?? asFinite(probabilities.bttsYes);
  const no = asFinite(probabilities.no) ?? asFinite(probabilities.bttsNo);
  if (yes !== undefined || no !== undefined) {
    const yesPct = Math.round((yes ?? 0.5) * 100);
    const noPct = Math.round((no ?? 0.5) * 100);
    return `${match.homeTeam.name} - ${match.awayTeam.name}: model analizi KG Var ${yesPct}%, KG Yok ${noPct}%.`;
  }

  return `${match.homeTeam.name} - ${match.awayTeam.name}: model analizi güncellendi.`;
}

function normalizeLegacyRow(row: LegacyPredictionRecord) {
  const probabilitySource = row.calibratedProbabilities ?? row.probabilities ?? row.rawProbabilities;
  return {
    matchId: row.matchId,
    modelVersionId: row.modelVersionId,
    probabilities: row.probabilities,
    calibratedProbabilities: row.calibratedProbabilities,
    rawProbabilities: row.rawProbabilities,
    expectedScore: row.expectedScore,
    confidenceScore: row.confidenceScore,
    summary: normalizeFallbackSummary(row.summary, row.match, probabilitySource),
    riskFlags: row.riskFlags,
    avoidReason: row.avoidReason,
    updatedAt: row.updatedAt,
    match: row.match
  };
}

function normalizePredictionRunFallbackRow(row: PredictionRunFallbackRecord) {
  const explanation = asRecord(row.explanationJson);
  const probabilitiesFromExplanation = explanation ? explanation.probabilities : null;
  const calibratedFromExplanation = explanation ? explanation.calibratedProbabilities : null;
  const rawFromExplanation = explanation ? explanation.rawProbabilities : null;
  const expectedScoreFromExplanation = explanation ? explanation.expectedScore : null;
  const summaryFromExplanation = explanation && typeof explanation.summary === "string" ? explanation.summary : "";
  const avoidReasonFromExplanation =
    explanation && typeof explanation.avoidReason === "string" ? explanation.avoidReason : null;

  const fallbackProbabilities = fallbackProbabilitiesByMarket(row.market, row.probability, explanation);
  const probabilities = probabilitiesFromExplanation ?? calibratedFromExplanation ?? fallbackProbabilities;
  const calibratedProbabilities = calibratedFromExplanation ?? probabilities;
  const rawProbabilities = rawFromExplanation ?? probabilities;
  const expectedScore = expectedScoreFromExplanation ?? null;
  const summary =
    summaryFromExplanation.length > 0
      ? summaryFromExplanation
      : `${row.match.homeTeam.name} - ${row.match.awayTeam.name}: prediction run ${row.market} tahmini.`;
  const summarySafe = normalizeFallbackSummary(summary, row.match, calibratedProbabilities ?? probabilities);

  return {
    matchId: row.matchId,
    modelVersionId: row.modelVersionId,
    probabilities,
    calibratedProbabilities,
    rawProbabilities,
    expectedScore,
    confidenceScore: row.confidence,
    summary: summarySafe,
    riskFlags: row.riskFlagsJson,
    avoidReason: avoidReasonFromExplanation,
    updatedAt: row.createdAt,
    match: row.match
  };
}

function buildFallbackExpandedItem(input: {
  matchId: string;
  modelVersionId: string | null;
  probabilities: unknown;
  calibratedProbabilities: unknown;
  rawProbabilities: unknown;
  expectedScore: unknown;
  confidenceScore: number;
  summary: string;
  riskFlags: unknown;
  avoidReason: string | null;
  updatedAt: Date;
  homeTeam: string;
  awayTeam: string;
  leagueId?: string;
  leagueName?: string;
  leagueCode?: string | null;
  matchDateTimeUTC: Date;
  status: MatchStatus;
  homeScore?: number | null;
  awayScore?: number | null;
  halfTimeHomeScore?: number | null;
  halfTimeAwayScore?: number | null;
}) {
  const normalized = normalizeProbabilities(input.probabilities, input.calibratedProbabilities, input.rawProbabilities);
  const expected = asRecord(input.expectedScore);
  const expectedHome = asFinite(expected?.home) ?? 1.25;
  const expectedAway = asFinite(expected?.away) ?? 1.05;

  const item: ExpandedPredictionItem = {
    matchId: input.matchId,
    modelVersionId: input.modelVersionId,
    leagueId: input.leagueId,
    leagueName: input.leagueName,
    leagueCode: input.leagueCode ?? undefined,
    predictionType: normalized.predictionType,
    marketKey: normalized.marketKey,
    probabilities: normalized.probabilities,
    expectedScore: { home: expectedHome, away: expectedAway },
    supportingSignals: [],
    contradictionSignals: [],
    riskFlags: normalizeRiskFlags(input.riskFlags),
    confidenceScore: Number.isFinite(input.confidenceScore) ? input.confidenceScore : 0.45,
    summary: input.summary || `${input.homeTeam} - ${input.awayTeam} maci icin fallback tahmin uretildi.`,
    avoidReason: input.avoidReason,
    updatedAt: input.updatedAt.toISOString(),
    matchStatus: input.status,
    homeScore: input.homeScore ?? null,
    awayScore: input.awayScore ?? null,
    halfTimeHomeScore: input.halfTimeHomeScore ?? null,
    halfTimeAwayScore: input.halfTimeAwayScore ?? null,
    isPlayed: input.status === MatchStatus.finished,
    homeTeam: input.homeTeam,
    awayTeam: input.awayTeam,
    matchDateTimeUTC: input.matchDateTimeUTC.toISOString(),
    commentary: {
      shortComment: `${input.homeTeam} - ${input.awayTeam} maci icin temel tahmin.`,
      detailedComment: "Ham model verisi normalize edilerek gosterime uygun hale getirildi.",
      expertComment: "Bu kayitta tam market ayrisimi olmadigi icin temel olasiliklar kullanilmistir.",
      confidenceNote: "Veri kalitesi sinirli olabilir; guncel sinyallerle birlikte degerlendirin."
    }
  };
  return item;
}

async function queryWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(`query_timeout_${timeoutMs}`));
      }, timeoutMs);
    })
  ]);
}

@Injectable()
export class PredictionsService {
  private readonly logger = new Logger(PredictionsService.name);
  private readonly allowLegacyPublicFallback = process.env.PUBLIC_PREDICTIONS_LEGACY_FALLBACK !== "0";
  private readonly allowSyntheticPublicFallback =
    process.env.NODE_ENV !== "production" && process.env.PUBLIC_PREDICTIONS_SYNTHETIC_FALLBACK === "1";

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly oddsService: OddsService,
    private readonly predictionStrategyRegistry: PredictionSportStrategyRegistry,
    private readonly pipelineRolloutService: PipelineRolloutService
  ) {}

  private async resolvePublicSource(seed: string) {
    return this.pipelineRolloutService.resolveSource({
      seed,
      isInternalRequest: false
    });
  }

  private async fetchLegacyRows(
    effectiveStatuses: MatchStatus[],
    sportCode: "football" | "basketball" | undefined,
    take: number
  ): Promise<LegacyPredictionRecord[]> {
    const targetTake = Math.max(take, 60);
    const relevantMatches =
      effectiveStatuses.length === 1
        ? await queryWithTimeout(
            this.prisma.match.findMany({
              where: {
                status: { in: effectiveStatuses },
                ...(sportCode ? { sport: { code: sportCode } } : {})
              },
              select: { id: true, matchDateTimeUTC: true },
              orderBy: { matchDateTimeUTC: "desc" },
              take: targetTake
            }),
            12000
          )
        : (
            await Promise.all(
              effectiveStatuses.map(async (status) => {
                try {
                  return await queryWithTimeout(
                    this.prisma.match.findMany({
                      where: {
                        status,
                        ...(sportCode ? { sport: { code: sportCode } } : {})
                      },
                      select: { id: true, matchDateTimeUTC: true },
                      orderBy: { matchDateTimeUTC: "desc" },
                      take: Math.max(Math.ceil(targetTake / effectiveStatuses.length) + 24, 36)
                    }),
                    9000
                  );
                } catch {
                  return [] as Array<{ id: string; matchDateTimeUTC: Date }>;
                }
              })
            )
          )
            .flat()
            .sort((left, right) => right.matchDateTimeUTC.getTime() - left.matchDateTimeUTC.getTime())
            .slice(0, targetTake);

    if (relevantMatches.length === 0) {
      return [];
    }

    const matchIds = relevantMatches.map((item) => item.id);
    let rows = await queryWithTimeout(
      this.prisma.prediction.findMany({
        where: {
          matchId: { in: matchIds },
          match: {
            status: { in: effectiveStatuses },
            ...(sportCode ? { sport: { code: sportCode } } : {})
          }
        },
        orderBy: { updatedAt: "desc" },
        include: LEGACY_PREDICTION_INCLUDE,
        take: Math.max(take * 2, 100)
      }),
      12000
    );

    if (rows.length === 0) {
      rows = await queryWithTimeout(
        this.prisma.prediction.findMany({
          where: {
            match: {
              status: { in: effectiveStatuses },
              ...(sportCode ? { sport: { code: sportCode } } : {})
            }
          },
          orderBy: { updatedAt: "desc" },
          include: LEGACY_PREDICTION_INCLUDE,
          take: Math.max(take * 3, 120)
        }),
        12000
      ).catch(() => []);
    }

    return rows as LegacyPredictionRecord[];
  }

  private async fetchLegacyRowsByMatch(matchId: string): Promise<LegacyPredictionRecord[]> {
    return queryWithTimeout(
      this.prisma.prediction.findMany({
        where: { matchId },
        orderBy: { updatedAt: "desc" },
        include: LEGACY_PREDICTION_INCLUDE,
        take: 80
      }),
      12000
    ).catch(() => []);
  }

  private async fetchLegacyHighConfidenceRows(): Promise<LegacyPredictionRecord[]> {
    return queryWithTimeout(
      this.prisma.prediction.findMany({
        where: {
          confidenceScore: { gte: 0.7 }
        },
        orderBy: { updatedAt: "desc" },
        include: LEGACY_PREDICTION_INCLUDE,
        take: 60
      }),
      12000
    ).catch(() => []);
  }

  private dedupePredictionRuns(rows: PredictionRunFallbackRecord[]) {
    const deduped = new Map<string, PredictionRunFallbackRecord>();
    for (const row of rows) {
      const dedupeKey = [row.matchId, row.market, row.lineKey, row.horizon].join("|");
      const existing = deduped.get(dedupeKey);
      if (!existing || row.createdAt.getTime() >= existing.createdAt.getTime()) {
        deduped.set(dedupeKey, row);
      }
    }
    return Array.from(deduped.values());
  }

  private async fetchPredictionRunRows(
    effectiveStatuses: MatchStatus[],
    sportCode: "football" | "basketball" | undefined,
    take: number,
    matchIds?: string[]
  ): Promise<PredictionRunFallbackRecord[]> {
    const baseWhere: Prisma.PredictionRunWhereInput = {
      match: {
        status: { in: effectiveStatuses },
        ...(sportCode ? { sport: { code: sportCode } } : {})
      }
    };
    const scopedWhere: Prisma.PredictionRunWhereInput =
      matchIds && matchIds.length > 0 ? { ...baseWhere, matchId: { in: matchIds } } : baseWhere;
    const maxRows = Math.max(take * 3, 180);

    const rows = await queryWithTimeout(
      this.prisma.predictionRun.findMany({
        where: scopedWhere,
        orderBy: { createdAt: "desc" },
        include: PREDICTION_RUN_FALLBACK_INCLUDE,
        take: maxRows
      }),
      12000
    ).catch(() => [] as PredictionRunFallbackRecord[]);

    if (rows.length > 0) {
      return this.dedupePredictionRuns(rows as PredictionRunFallbackRecord[]);
    }

    if (!matchIds || matchIds.length === 0) {
      return [];
    }

    const relaxedRows = await queryWithTimeout(
      this.prisma.predictionRun.findMany({
        where: baseWhere,
        orderBy: { createdAt: "desc" },
        include: PREDICTION_RUN_FALLBACK_INCLUDE,
        take: maxRows
      }),
      12000
    ).catch(() => [] as PredictionRunFallbackRecord[]);

    return this.dedupePredictionRuns(relaxedRows as PredictionRunFallbackRecord[]);
  }

  private async fetchPredictionRunRowsByMatch(matchId: string): Promise<PredictionRunFallbackRecord[]> {
    const rows = await queryWithTimeout(
      this.prisma.predictionRun.findMany({
        where: { matchId },
        orderBy: { createdAt: "desc" },
        include: PREDICTION_RUN_FALLBACK_INCLUDE,
        take: 120
      }),
      12000
    ).catch(() => [] as PredictionRunFallbackRecord[]);

    return this.dedupePredictionRuns(rows as PredictionRunFallbackRecord[]);
  }

  private async fetchPredictionRunHighConfidenceRows(): Promise<PredictionRunFallbackRecord[]> {
    const rows = await queryWithTimeout(
      this.prisma.predictionRun.findMany({
        where: { confidence: { gte: 0.7 } },
        orderBy: { createdAt: "desc" },
        include: PREDICTION_RUN_FALLBACK_INCLUDE,
        take: 120
      }),
      12000
    ).catch(() => [] as PredictionRunFallbackRecord[]);

    return this.dedupePredictionRuns(rows as PredictionRunFallbackRecord[]);
  }

  private buildSyntheticRowsFromMatches(matches: MatchStubRecord[], sportCode?: "football" | "basketball") {
    const safeSportCode = sportCode === "basketball" ? "basketball" : "football";
    return matches.map((match, index) => {
      const hashSeed = Number.parseInt(match.id.replace(/-/g, "").slice(0, 8), 16);
      const bias = Number.isFinite(hashSeed) ? ((hashSeed % 7) - 3) * 0.01 : 0;
      const fallbackHomeElo = 1490 + (hashSeed % 160);
      const fallbackAwayElo = 1480 + (hashSeed % 145);
      const homeElo = asFinite(match.homeElo) ?? fallbackHomeElo;
      const awayElo = asFinite(match.awayElo) ?? fallbackAwayElo;
      const adjustedHome = homeElo + 18;
      const homeWinShare = 1 / (1 + Math.pow(10, (awayElo - adjustedHome) / 400));
      const eloGap = Math.abs(adjustedHome - awayElo);
      const draw = safeSportCode === "football" ? Math.max(0.18, Math.min(0.3, 0.28 - eloGap / 2200)) : 0;
      const remaining = Math.max(0.0001, 1 - draw);
      const home = Number((remaining * homeWinShare).toFixed(4));
      const away = Number(Math.max(0.0001, remaining - home).toFixed(4));
      const normalizedSum = safeSportCode === "football" ? home + draw + away : home + away;
      const normalizedHome = Number((home / normalizedSum).toFixed(4));
      const normalizedDraw = safeSportCode === "football" ? Number((draw / normalizedSum).toFixed(4)) : 0;
      const normalizedAway = Number(((1 - normalizedHome - normalizedDraw)).toFixed(4));
      const sorted = safeSportCode === "football"
        ? [normalizedHome, normalizedDraw, normalizedAway].sort((a, b) => b - a)
        : [normalizedHome, normalizedAway].sort((a, b) => b - a);
      const top = sorted[0] ?? 0.5;
      const second = sorted[1] ?? 0.4;
      const confidence = Number((top * 0.75 + (top - second) * 0.25).toFixed(4));
      const expectedHome = Number((0.78 + normalizedHome * 1.95 + normalizedDraw * 0.28 + bias * 2.2).toFixed(2));
      const expectedAway = Number((0.68 + normalizedAway * 1.8 + normalizedDraw * 0.24 - bias * 1.8).toFixed(2));
      const summary =
        safeSportCode === "football"
          ? `${safeTeamName(match.homeTeam?.name, `Ev Takim ${index + 1}`)} - ${safeTeamName(match.awayTeam?.name, `Deplasman Takim ${index + 1}`)}: Ev ${Math.round(
              normalizedHome * 100
            )}%, Beraberlik ${Math.round(normalizedDraw * 100)}%, Deplasman ${Math.round(normalizedAway * 100)}%.`
          : `${safeTeamName(match.homeTeam?.name, `Ev Takim ${index + 1}`)} - ${safeTeamName(match.awayTeam?.name, `Deplasman Takim ${index + 1}`)}: Ev ${Math.round(
              normalizedHome * 100
            )}%, Deplasman ${Math.round(normalizedAway * 100)}%.`;
      const riskFlags =
        confidence < 0.55
          ? [{ code: "LOW_CONFIDENCE", severity: "high", message: "Prediction confidence is low." }]
          : confidence < 0.65
            ? [{ code: "MEDIUM_VARIANCE", severity: "medium", message: "Outcome variance is elevated." }]
            : [];

      return {
        matchId: match.id,
        modelVersionId: null,
        probabilities: safeSportCode === "football" ? { home: normalizedHome, draw: normalizedDraw, away: normalizedAway } : { home: normalizedHome, away: normalizedAway },
        calibratedProbabilities:
          safeSportCode === "football"
            ? { home: normalizedHome, draw: normalizedDraw, away: normalizedAway }
            : { home: normalizedHome, away: normalizedAway },
        rawProbabilities:
          safeSportCode === "football"
            ? { home: normalizedHome, draw: normalizedDraw, away: normalizedAway }
            : { home: normalizedHome, away: normalizedAway },
        expectedScore:
          safeSportCode === "basketball"
            ? { home: Number((77 + normalizedHome * 8 + bias * 35).toFixed(1)), away: Number((74 + normalizedAway * 8 - bias * 25).toFixed(1)) }
            : { home: expectedHome, away: expectedAway },
        confidenceScore: confidence,
        summary,
        riskFlags,
        avoidReason: null,
        updatedAt: new Date(),
        match: {
          sport: { code: match.sport?.code ?? safeSportCode },
          status: match.status,
          matchDateTimeUTC: match.matchDateTimeUTC,
          homeScore: match.homeScore,
          awayScore: match.awayScore,
          halfTimeHomeScore: match.halfTimeHomeScore,
          halfTimeAwayScore: match.halfTimeAwayScore,
          q1HomeScore: null,
          q1AwayScore: null,
          q2HomeScore: null,
          q2AwayScore: null,
          q3HomeScore: null,
          q3AwayScore: null,
          q4HomeScore: null,
          q4AwayScore: null,
          homeTeam: { name: safeTeamName(match.homeTeam?.name, `Ev Takim ${index + 1}`) },
          awayTeam: { name: safeTeamName(match.awayTeam?.name, `Deplasman Takim ${index + 1}`) },
          league: match.league ?? null
        }
      } satisfies NormalizedPredictionRow;
    });
  }

  private buildPublishedWhere(
    baseWhere: Prisma.PublishedPredictionWhereInput,
    includeDecisionGate: boolean
  ): Prisma.PublishedPredictionWhereInput {
    if (!includeDecisionGate) {
      return baseWhere;
    }

    return {
      AND: [
        baseWhere,
        {
          OR: [
            { publishDecision: { is: null } },
            { publishDecision: { is: { status: { in: FINAL_PUBLISH_DECISION_STATUSES } } } }
          ]
        }
      ]
    };
  }

  private formatErrorMessage(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 240);
  }

  private async findPublishedRows(
    baseWhere: Prisma.PublishedPredictionWhereInput,
    take: number,
    orderBy: Prisma.Enumerable<Prisma.PublishedPredictionOrderByWithRelationInput> = { publishedAt: "desc" }
  ): Promise<PublishedPredictionRecord[]> {
    const query = (includeDecisionGate: boolean) =>
      queryWithTimeout(
        this.prisma.publishedPrediction.findMany({
          where: this.buildPublishedWhere(baseWhere, includeDecisionGate),
          orderBy,
          include: PUBLISHED_PREDICTION_INCLUDE,
          take
        }),
        12000
      ) as Promise<PublishedPredictionRecord[]>;

    try {
      return await query(true);
    } catch (strictError) {
      this.logger.warn(
        `Strict published query failed, retrying without decision gate: ${this.formatErrorMessage(strictError)}`
      );
      try {
        return await query(false);
      } catch {
        throw strictError;
      }
    }
  }

  private expandRows(normalizedRows: NormalizedPredictionRow[]) {
    return normalizedRows.flatMap((item) => {
      const matchRecord = (item.match as Record<string, unknown> | null) ?? null;
      const safeUpdatedAt =
        item.updatedAt instanceof Date && Number.isFinite(item.updatedAt.getTime()) ? item.updatedAt : new Date();
      const rawMatchDateTime = matchRecord?.matchDateTimeUTC;
      const matchDateTime =
        rawMatchDateTime instanceof Date && Number.isFinite(rawMatchDateTime.getTime())
          ? rawMatchDateTime
          : new Date(safeUpdatedAt.getTime() + 2 * 60 * 60 * 1000);
      const sportCodeRaw = (matchRecord?.sport as Record<string, unknown> | null)?.code;
      const sportCode = typeof sportCodeRaw === "string" && sportCodeRaw.trim().length > 0 ? sportCodeRaw : "football";
      const homeTeamName = safeTeamName((matchRecord?.homeTeam as Record<string, unknown> | null)?.name, "Bilinmeyen Ev Takim");
      const awayTeamName = safeTeamName((matchRecord?.awayTeam as Record<string, unknown> | null)?.name, "Bilinmeyen Deplasman Takim");
      const league = safeLeague(matchRecord?.league);
      const matchStatus = toMatchStatus(matchRecord?.status);

      try {
        return this.predictionStrategyRegistry.forSport(sportCode).expand({
          matchId: item.matchId,
          modelVersionId: item.modelVersionId,
          probabilities: item.probabilities,
          calibratedProbabilities: item.calibratedProbabilities,
          rawProbabilities: item.rawProbabilities,
          expectedScore: item.expectedScore,
          confidenceScore: item.confidenceScore,
          summary: item.summary,
          riskFlags: item.riskFlags,
          avoidReason: item.avoidReason,
          updatedAt: safeUpdatedAt,
          match: {
            homeTeam: { name: homeTeamName },
            awayTeam: { name: awayTeamName },
            league,
            matchDateTimeUTC: matchDateTime,
            status: matchStatus,
            homeScore: typeof matchRecord?.homeScore === "number" ? matchRecord.homeScore : null,
            awayScore: typeof matchRecord?.awayScore === "number" ? matchRecord.awayScore : null,
            halfTimeHomeScore: typeof matchRecord?.halfTimeHomeScore === "number" ? matchRecord.halfTimeHomeScore : null,
            halfTimeAwayScore: typeof matchRecord?.halfTimeAwayScore === "number" ? matchRecord.halfTimeAwayScore : null,
            q1HomeScore: typeof matchRecord?.q1HomeScore === "number" ? matchRecord.q1HomeScore : null,
            q1AwayScore: typeof matchRecord?.q1AwayScore === "number" ? matchRecord.q1AwayScore : null,
            q2HomeScore: typeof matchRecord?.q2HomeScore === "number" ? matchRecord.q2HomeScore : null,
            q2AwayScore: typeof matchRecord?.q2AwayScore === "number" ? matchRecord.q2AwayScore : null,
            q3HomeScore: typeof matchRecord?.q3HomeScore === "number" ? matchRecord.q3HomeScore : null,
            q3AwayScore: typeof matchRecord?.q3AwayScore === "number" ? matchRecord.q3AwayScore : null,
            q4HomeScore: typeof matchRecord?.q4HomeScore === "number" ? matchRecord.q4HomeScore : null,
            q4AwayScore: typeof matchRecord?.q4AwayScore === "number" ? matchRecord.q4AwayScore : null
          }
        });
      } catch {
        return [
          buildFallbackExpandedItem({
            matchId: item.matchId,
            modelVersionId: item.modelVersionId,
            probabilities: item.probabilities,
            calibratedProbabilities: item.calibratedProbabilities,
            rawProbabilities: item.rawProbabilities,
            expectedScore: item.expectedScore,
            confidenceScore: item.confidenceScore,
            summary: item.summary,
            riskFlags: item.riskFlags,
            avoidReason: item.avoidReason,
            updatedAt: safeUpdatedAt,
            homeTeam: homeTeamName,
            awayTeam: awayTeamName,
            leagueId: league?.id,
            leagueName: league?.name,
            leagueCode: league?.code,
            matchDateTimeUTC: matchDateTime,
            status: matchStatus,
            homeScore: typeof matchRecord?.homeScore === "number" ? matchRecord.homeScore : null,
            awayScore: typeof matchRecord?.awayScore === "number" ? matchRecord.awayScore : null,
            halfTimeHomeScore: typeof matchRecord?.halfTimeHomeScore === "number" ? matchRecord.halfTimeHomeScore : null,
            halfTimeAwayScore: typeof matchRecord?.halfTimeAwayScore === "number" ? matchRecord.halfTimeAwayScore : null
          })
        ];
      }
    });
  }

  async list(params?: ListPredictionsParams) {
    const statuses = parseStatusFilter(params?.status);
    const sportCode = parseSportFilter(params?.sport);
    const effectiveStatuses = statuses ?? [MatchStatus.scheduled, MatchStatus.live];
    const predictionType = parsePredictionType(params?.predictionType);
    const line = parseLine(params?.line);
    const take = parseTake(params?.take, statuses !== undefined);
    const includeMarketAnalysis = params?.includeMarketAnalysis === true;
    const statusKey = effectiveStatuses.join("|");
    const typeKey = predictionType ?? "all";
    const sportKey = sportCode ?? "all";
    const lineKey = line === undefined ? "all" : String(line);
    const takeKey = String(take);
    const analysisKey = includeMarketAnalysis ? "market" : "nomarket";
    const cacheKey = `predictions:list:v15:public:${sportKey}:${statusKey}:${typeKey}:${lineKey}:${takeKey}:${analysisKey}`;
    const stableCacheKey = `${cacheKey}:stable`;
    const cached = await this.cache.get<unknown[]>(cacheKey);
    if (cached) {
      if (!this.allowSyntheticPublicFallback && isSyntheticExpandedPayload(cached)) {
        this.logger.warn(
          `Synthetic cache ignored for predictions list (status=${statusKey}, sport=${sportKey}, take=${take}).`
        );
      } else {
        return cached;
      }
    }

    const stableCached = await this.cache.get<unknown[]>(stableCacheKey);
    if (stableCached) {
      if (!this.allowSyntheticPublicFallback && isSyntheticExpandedPayload(stableCached)) {
        this.logger.warn(
          `Synthetic stable cache ignored for predictions list (status=${statusKey}, sport=${sportKey}, take=${take}).`
        );
      } else {
        await this.cache.set(cacheKey, stableCached, 20, ["predictions", "market-analysis"]);
        return stableCached;
      }
    }

    let normalizedRows: NormalizedPredictionRow[] = [];

    try {
      const targetTake = Math.max(take, 60);
      const relevantMatches =
        effectiveStatuses.length === 1
          ? await queryWithTimeout(
              this.prisma.match.findMany({
                where: {
                  status: { in: effectiveStatuses },
                  ...(sportCode ? { sport: { code: sportCode } } : {})
                },
                select: {
                  id: true,
                  matchDateTimeUTC: true,
                  status: true,
                  homeScore: true,
                  awayScore: true,
                  halfTimeHomeScore: true,
                  halfTimeAwayScore: true,
                  homeElo: true,
                  awayElo: true,
                  form5Home: true,
                  form5Away: true,
                  homeTeam: { select: { name: true } },
                  awayTeam: { select: { name: true } },
                  league: { select: { id: true, name: true, code: true } },
                  sport: { select: { code: true } }
                },
                orderBy: { matchDateTimeUTC: "desc" },
                take: targetTake
              }),
              12000
            )
          : (
              await Promise.all(
                effectiveStatuses.map(async (status) => {
                  try {
                    return await queryWithTimeout(
                      this.prisma.match.findMany({
                        where: {
                          status,
                          ...(sportCode ? { sport: { code: sportCode } } : {})
                        },
                        select: {
                          id: true,
                          matchDateTimeUTC: true,
                          status: true,
                          homeScore: true,
                          awayScore: true,
                          halfTimeHomeScore: true,
                          halfTimeAwayScore: true,
                          homeElo: true,
                          awayElo: true,
                          form5Home: true,
                          form5Away: true,
                          homeTeam: { select: { name: true } },
                          awayTeam: { select: { name: true } },
                          league: { select: { id: true, name: true, code: true } },
                          sport: { select: { code: true } }
                        },
                        orderBy: { matchDateTimeUTC: "desc" },
                        take: Math.max(Math.ceil(targetTake / effectiveStatuses.length) + 24, 36)
                      }),
                      9000
                    );
                  } catch {
                    return [] as MatchStubRecord[];
                  }
                })
              )
            )
              .flat()
              .sort((left, right) => right.matchDateTimeUTC.getTime() - left.matchDateTimeUTC.getTime())
              .slice(0, targetTake);

      if (relevantMatches.length === 0) {
        await this.cache.set(cacheKey, [], 20, ["predictions", "market-analysis"]);
        return [];
      }

      const matchIds = relevantMatches.map((item) => item.id);
      let rows = await this.findPublishedRows(
        {
          matchId: { in: matchIds },
          match: {
            status: { in: effectiveStatuses },
            ...(sportCode ? { sport: { code: sportCode } } : {})
          }
        },
        Math.max(take * 2, 100)
      );

      if (rows.length === 0) {
        rows = await this.findPublishedRows(
          {
            match: {
              status: { in: effectiveStatuses },
              ...(sportCode ? { sport: { code: sportCode } } : {})
            }
          },
          Math.max(take * 3, 120)
        ).catch(() => []);
      }

      normalizedRows = rows.map((row) => normalizePublishedRow(row));
      if (normalizedRows.length === 0 && this.allowLegacyPublicFallback) {
        const legacyRows = await this.fetchLegacyRows(effectiveStatuses, sportCode, take);
        if (legacyRows.length > 0 && !areLegacyRowsSyntheticOnly(legacyRows)) {
          this.logger.warn(
            `Public predictions fallback activated for status=${statusKey}, sport=${sportKey}, take=${take}`
          );
          normalizedRows = legacyRows.map((row) => normalizeLegacyRow(row));
        } else {
          if (legacyRows.length > 0) {
            this.logger.warn(
              `Legacy fallback skipped because rows are synthetic-only; trying prediction-run fallback (status=${statusKey}, sport=${sportKey}).`
            );
          }
          const runRows = await this.fetchPredictionRunRows(effectiveStatuses, sportCode, take, matchIds);
          if (runRows.length > 0 && !arePredictionRunRowsSyntheticOnly(runRows)) {
            this.logger.warn(
              `Public predictions prediction-run fallback activated for status=${statusKey}, sport=${sportKey}, take=${take}`
            );
            normalizedRows = runRows.map((row) => normalizePredictionRunFallbackRow(row));
          } else if (runRows.length > 0) {
            this.logger.warn(
              `Prediction-run fallback skipped because rows are synthetic-only (status=${statusKey}, sport=${sportKey}).`
            );
          }
        }
      }
      if (normalizedRows.length === 0 && this.allowLegacyPublicFallback && this.allowSyntheticPublicFallback) {
        normalizedRows = this.buildSyntheticRowsFromMatches(relevantMatches, sportCode);
        if (normalizedRows.length > 0) {
          this.logger.warn(
            `Public predictions synthetic fallback activated for status=${statusKey}, sport=${sportKey}, take=${take}`
          );
        }
      }
    } catch {
      const stale = await this.cache.get<unknown[]>(stableCacheKey);
      if (stale && !isSyntheticExpandedPayload(stale)) {
        await this.cache.set(cacheKey, stale, 12, ["predictions", "market-analysis"]);
        return stale;
      }
      if (stale && isSyntheticExpandedPayload(stale)) {
        this.logger.warn(
          `Synthetic stale cache ignored for predictions list (status=${statusKey}, sport=${sportKey}, take=${take}).`
        );
      }
      if (!this.allowLegacyPublicFallback) {
        return [];
      }
      const runRows = await this.fetchPredictionRunRows(effectiveStatuses, sportCode, take).catch(() => []);
      if (runRows.length > 0 && !arePredictionRunRowsSyntheticOnly(runRows)) {
        normalizedRows = runRows.map((row) => normalizePredictionRunFallbackRow(row));
      } else if (runRows.length > 0) {
        this.logger.warn(
          `Prediction-run fallback skipped in error path because rows are synthetic-only (status=${statusKey}, sport=${sportKey}).`
        );
      } else {
        const legacyRows = await this.fetchLegacyRows(effectiveStatuses, sportCode, take).catch(() => []);
        if (legacyRows.length > 0 && !areLegacyRowsSyntheticOnly(legacyRows)) {
          normalizedRows = legacyRows.map((row) => normalizeLegacyRow(row));
        } else if (this.allowSyntheticPublicFallback) {
          const syntheticMatches = await queryWithTimeout(
            this.prisma.match.findMany({
              where: {
                status: { in: effectiveStatuses },
                ...(sportCode ? { sport: { code: sportCode } } : {})
              },
              select: {
                id: true,
                matchDateTimeUTC: true,
                status: true,
                homeScore: true,
                awayScore: true,
                halfTimeHomeScore: true,
                halfTimeAwayScore: true,
                homeElo: true,
                awayElo: true,
                form5Home: true,
                form5Away: true,
                homeTeam: { select: { name: true } },
                awayTeam: { select: { name: true } },
                league: { select: { id: true, name: true, code: true } },
                sport: { select: { code: true } }
              },
              orderBy: { matchDateTimeUTC: "desc" },
              take: Math.max(take, 60)
            }),
            9000
          ).catch(() => [] as MatchStubRecord[]);
          if (syntheticMatches.length === 0) {
            return [];
          }
          normalizedRows = this.buildSyntheticRowsFromMatches(syntheticMatches, sportCode);
        }
      }
    }
    const expanded = this.expandRows(normalizedRows);

    const payload = predictionType
      ? expanded.filter((item) => item.predictionType === predictionType)
      : expanded;

    const lineFiltered = line === undefined ? payload : payload.filter((item) => item.line === line);
    lineFiltered.sort((left, right) => {
      const leftTs = left.matchDateTimeUTC ? Date.parse(left.matchDateTimeUTC) : 0;
      const rightTs = right.matchDateTimeUTC ? Date.parse(right.matchDateTimeUTC) : 0;
      return rightTs - leftTs;
    });
    const uniqueByMarket = new Map<string, (typeof lineFiltered)[number]>();
    for (const item of lineFiltered) {
      const dedupeKey = [
        item.matchId,
        item.predictionType,
        item.line === undefined ? "na" : String(item.line),
        item.marketKey ?? "market",
        item.selectionLabel ?? "selection"
      ].join("|");
      if (!uniqueByMarket.has(dedupeKey)) {
        uniqueByMarket.set(dedupeKey, item);
      }
    }
    const deduped = Array.from(uniqueByMarket.values());
    const enriched = await this.oddsService
      .attachMarketAnalysis(deduped, includeMarketAnalysis, line)
      .catch(() => deduped);

    await this.cache.set(cacheKey, enriched, 20, ["predictions", "market-analysis"]);
    await this.cache.set(stableCacheKey, enriched, 300, ["predictions", "market-analysis"]);
    return enriched;
  }

  async listByMatch(matchId: string, params?: ListByMatchParams) {
    const predictionType = parsePredictionType(params?.predictionType);
    const line = parseLine(params?.line);
    const includeMarketAnalysis = params?.includeMarketAnalysis === true;

    const rows = await this.findPublishedRows({ matchId }, 20, [{ publishedAt: "desc" }]).catch((error) => {
      this.logger.warn(`listByMatch fallback to empty set due to query error: ${this.formatErrorMessage(error)}`);
      return [] as PublishedPredictionRecord[];
    });

    let normalizedRows: NormalizedPredictionRow[] = rows.map((row) => normalizePublishedRow(row));

    if (normalizedRows.length === 0 && this.allowLegacyPublicFallback) {
      const legacyRows = await this.fetchLegacyRowsByMatch(matchId);
      if (legacyRows.length > 0 && !areLegacyRowsSyntheticOnly(legacyRows)) {
        normalizedRows = legacyRows.map((row) => normalizeLegacyRow(row));
      } else {
        if (legacyRows.length > 0) {
          this.logger.warn(
            `Legacy by-match fallback skipped because rows are synthetic-only; trying prediction-run fallback (matchId=${matchId}).`
          );
        }
        const runRows = await this.fetchPredictionRunRowsByMatch(matchId);
        if (runRows.length > 0 && !arePredictionRunRowsSyntheticOnly(runRows)) {
          normalizedRows = runRows.map((row) => normalizePredictionRunFallbackRow(row));
        } else if (runRows.length > 0) {
          this.logger.warn(`Prediction-run by-match fallback skipped because rows are synthetic-only (matchId=${matchId}).`);
        }
      }
    }

    if (normalizedRows.length === 0) {
      return [];
    }

    const expanded = this.expandRows(normalizedRows);

    const filteredByType = predictionType
      ? expanded.filter((item) => item.predictionType === predictionType)
      : expanded;
    const lineFiltered = line === undefined ? filteredByType : filteredByType.filter((item) => item.line === line);

    const uniqueByMarket = new Map<string, (typeof lineFiltered)[number]>();
    for (const item of lineFiltered) {
      const dedupeKey = [
        item.matchId,
        item.predictionType,
        item.line === undefined ? "na" : String(item.line),
        item.marketKey ?? "market",
        item.selectionLabel ?? "selection"
      ].join("|");
      if (!uniqueByMarket.has(dedupeKey)) {
        uniqueByMarket.set(dedupeKey, item);
      }
    }

    const deduped = Array.from(uniqueByMarket.values());
    return this.oddsService.attachMarketAnalysis(deduped, includeMarketAnalysis, line).catch(() => deduped);
  }

  async highConfidence() {
    const rows = await this.findPublishedRows(
      {
        predictionRun: {
          confidence: { gte: 0.7 }
        }
      },
      50
    ).catch((error) => {
      this.logger.warn(`highConfidence fallback to empty set due to query error: ${this.formatErrorMessage(error)}`);
      return [] as PublishedPredictionRecord[];
    });

    if (rows.length > 0) {
      return rows.map((row) => normalizePublishedRow(row));
    }

    if (!this.allowLegacyPublicFallback) {
      return [];
    }

    const legacyRows = await this.fetchLegacyHighConfidenceRows();
    if (legacyRows.length > 0) {
      return legacyRows.map((row) => normalizeLegacyRow(row));
    }

    const runRows = await this.fetchPredictionRunHighConfidenceRows();
    if (runRows.length > 0 && !arePredictionRunRowsSyntheticOnly(runRows)) {
      return runRows.map((row) => normalizePredictionRunFallbackRow(row));
    }
    return [];
  }
}
