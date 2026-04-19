type UnknownRecord = Record<string, unknown>;

type Severity = "low" | "medium" | "high" | "critical" | "unknown";

export type ApiRiskFlag = {
  code: string;
  severity: Severity;
  message: string;
};

export type ExpandedPredictionItem = {
  matchId: string;
  modelVersionId?: string | null;
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

function round4(value: number) {
  return Number(value.toFixed(4));
}

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
  const status = (statusRaw ?? "").toLowerCase();
  const hasScore = homeScore !== null && homeScore !== undefined && awayScore !== null && awayScore !== undefined;
  const now = Date.now();
  const kickoffMs = kickoffAt?.getTime();
  if (hasScore && kickoffMs !== undefined && kickoffMs <= now + 2 * 60 * 60 * 1000) {
    return "finished";
  }
  if (status.length > 0) {
    return status;
  }
  if (hasScore && kickoffMs !== undefined && kickoffMs <= now + 2 * 60 * 60 * 1000) {
    return "finished";
  }
  return "scheduled";
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
  const rawBttsYes = clampProbability((1 - Math.exp(-expectedScore.home)) * (1 - Math.exp(-expectedScore.away)));
  const over25Proxy = totalGoalsOverProbability(totalLambda, 2.5);
  const outcomeImbalance = Math.abs(baseOutcome.home - baseOutcome.away);
  const balanceMultiplier = Math.max(0.75, 1 - Math.min(0.25, outcomeImbalance * 0.45));
  const totalGoalsAdjustment = (over25Proxy - 0.5) * 0.28;
  const bttsYes = clampProbability(rawBttsYes * balanceMultiplier + totalGoalsAdjustment);
  const bttsNo = clampProbability(1 - bttsYes);
  const riskFlags = normalizeRiskFlags(row.riskFlags);
  const confidence = clampProbability(row.confidenceScore);

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
    const under = clampProbability(1 - over);
    return {
      ...baseItem,
      predictionType: "totalGoalsOverUnder",
      marketKey: `over_under_${line}`,
      selectionLabel: `MS ${line.toFixed(1)} Alt/Üst`,
      line,
      probabilities: {
        over: round4(over),
        under: round4(under)
      },
      confidenceScore: round4(Math.max(0.35, confidence - 0.03))
    };
  });

  const firstHalfOver = totalGoalsOverProbability(firstHalfLambdaHome + firstHalfLambdaAway, 0.5);
  const secondHalfOver = totalGoalsOverProbability(secondHalfLambdaHome + secondHalfLambdaAway, 0.5);

  const matrix = createHalfTimeFullTimeProbabilities(firstHalfOutcome, baseOutcome);
  const correctScore = correctScoreDistribution(expectedScore.home, expectedScore.away);
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
      probabilities: firstHalfOutcome,
      confidenceScore: round4(Math.max(0.32, confidence - 0.05))
    },
    {
      ...baseItem,
      predictionType: "halfTimeFullTime",
      marketKey: "half_time_full_time",
      probabilities: matrix,
      confidenceScore: round4(Math.max(0.3, confidence - 0.08))
    },
    {
      ...baseItem,
      predictionType: "bothTeamsToScore",
      marketKey: "both_teams_to_score",
      probabilities: {
        yes: round4(bttsYes),
        no: round4(bttsNo),
        bttsYes: round4(bttsYes),
        bttsNo: round4(bttsNo)
      },
      confidenceScore: round4(Math.max(0.35, confidence - 0.02))
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
      confidenceScore: round4(Math.max(0.3, confidence - 0.12))
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
        over: round4(firstHalfOver),
        under: round4(1 - firstHalfOver)
      },
      confidenceScore: round4(Math.max(0.33, confidence - 0.06))
    },
    {
      ...baseItem,
      predictionType: "secondHalfGoals",
      marketKey: "second_half_goals",
      selectionLabel: "2Y 0.5 Alt/Üst",
      line: 0.5,
      probabilities: {
        over: round4(secondHalfOver),
        under: round4(1 - secondHalfOver)
      },
      confidenceScore: round4(Math.max(0.33, confidence - 0.06))
    }
  ];
}
