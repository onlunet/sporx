import { ExpandedPredictionItem, PredictionRowInput } from "./prediction-markets.util";

type UnknownRecord = Record<string, unknown>;

type ApiRiskFlag = {
  code: string;
  severity: "low" | "medium" | "high" | "critical" | "unknown";
  message: string;
};

function asRecord(value: unknown): UnknownRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as UnknownRecord;
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
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

function normalizeOutcome(raw: unknown) {
  const record = asRecord(raw);
  const home =
    asNumber(record?.home) ??
    asNumber(record?.moneylineHome) ??
    asNumber(record?.homeWin) ??
    asNumber(record?.home_win);
  const away =
    asNumber(record?.away) ??
    asNumber(record?.moneylineAway) ??
    asNumber(record?.awayWin) ??
    asNumber(record?.away_win);
  const draw = asNumber(record?.draw) ?? 0.004;
  if (home === null || away === null) {
    return {
      home: 0.5,
      draw: 0.004,
      away: 0.496
    };
  }

  const safe = {
    home: clampProbability(home),
    draw: clampProbability(draw),
    away: clampProbability(away)
  };
  const sum = safe.home + safe.draw + safe.away || 1;
  return {
    home: round4(safe.home / sum),
    draw: round4(safe.draw / sum),
    away: round4(safe.away / sum)
  };
}

function normalizeExpectedScore(raw: unknown) {
  const record = asRecord(raw);
  const home = asNumber(record?.home) ?? 108;
  const away = asNumber(record?.away) ?? 105;
  const total = asNumber(record?.expectedTotal) ?? home + away;
  const firstHalfTotal = asNumber(record?.firstHalfTotal) ?? total * 0.485;
  const secondHalfTotal = asNumber(record?.secondHalfTotal) ?? total - firstHalfTotal;
  const spread = asNumber(record?.expectedSpreadHome) ?? home - away;
  const lineRowsRaw = Array.isArray(record?.totalLines) ? (record?.totalLines as unknown[]) : [];
  const totalLines = lineRowsRaw
    .map((row) => {
      const rowRecord = asRecord(row);
      if (!rowRecord) {
        return null;
      }
      const line = asNumber(rowRecord.line);
      const over = asNumber(rowRecord.over);
      const under = asNumber(rowRecord.under);
      if (line === null || over === null || under === null) {
        return null;
      }
      return {
        line: Number(line.toFixed(1)),
        over: round4(clampProbability(over)),
        under: round4(clampProbability(under))
      };
    })
    .filter((item): item is { line: number; over: number; under: number } => item !== null);

  return {
    home,
    away,
    expectedTotal: total,
    expectedSpreadHome: spread,
    firstHalfTotal,
    secondHalfTotal,
    totalLines
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
      const severityRaw = typeof record.severity === "string" ? record.severity.toLowerCase() : "unknown";
      const severity: ApiRiskFlag["severity"] =
        severityRaw === "low" || severityRaw === "medium" || severityRaw === "high" || severityRaw === "critical"
          ? severityRaw
          : "unknown";
      const message =
        typeof record.message === "string" && record.message.trim().length > 0
          ? record.message
          : "Tahmin oynakligi artmis olabilir.";
      return { code, severity, message };
    })
    .filter((item): item is ApiRiskFlag => item !== null);
}

function confidenceNote(confidenceScore: number, riskFlags: ApiRiskFlag[]) {
  if (confidenceScore >= 0.72 && riskFlags.length === 0) {
    return "Model guven skoru yuksek. Son dakika kadro degisiklikleri yine sonucu etkileyebilir.";
  }
  if (confidenceScore >= 0.58) {
    return "Guven skoru orta seviyede. Piyasa ve kadro sinyalleri ile birlikte degerlendirin.";
  }
  return "Guven skoru dusuk. Tahmini tek basina karar verici olarak kullanmayin.";
}

function lineOverProbability(expectedTotal: number, line: number) {
  const scaled = (expectedTotal - line) / 12;
  return clampProbability(1 / (1 + Math.exp(-scaled)));
}

export function expandBasketballPredictionMarkets(row: PredictionRowInput): ExpandedPredictionItem[] {
  const outcome = normalizeOutcome(row.calibratedProbabilities ?? row.probabilities ?? row.rawProbabilities);
  const expected = normalizeExpectedScore(row.expectedScore);
  const riskFlags = normalizeRiskFlags(row.riskFlags);
  const confidence = round4(clampProbability(row.confidenceScore));
  const homeTeam = row.match?.homeTeam?.name ?? "Ev Sahibi";
  const awayTeam = row.match?.awayTeam?.name ?? "Deplasman";

  const sharedCommentary = {
    shortComment: `${homeTeam} - ${awayTeam} basketbol macinda model yonu belirlendi.`,
    detailedComment: `Ev kazanir %${Math.round(outcome.home * 100)}, dep kazanir %${Math.round(
      outcome.away * 100
    )}. Beklenen toplam ${expected.expectedTotal.toFixed(1)}.`,
    expertComment:
      riskFlags.length > 0
        ? `Risk sinyalleri mevcut: ${riskFlags.map((flag) => flag.code).join(", ")}.`
        : "Belirgin risk bayragi bulunmuyor.",
    confidenceNote: confidenceNote(confidence, riskFlags)
  };

  const summary =
    row.summary && row.summary.trim().length > 0
      ? row.summary
      : `${homeTeam} - ${awayTeam}: Ev %${Math.round(outcome.home * 100)}, Dep %${Math.round(outcome.away * 100)}.`;

  const totalLines =
    expected.totalLines.length > 0
      ? expected.totalLines
      : [expected.expectedTotal - 10, expected.expectedTotal - 5, expected.expectedTotal, expected.expectedTotal + 5].map(
          (line) => {
            const rounded = Number((Math.round(line / 0.5) * 0.5).toFixed(1));
            const over = lineOverProbability(expected.expectedTotal, rounded);
            return {
              line: rounded,
              over: round4(over),
              under: round4(1 - over)
            };
          }
        );

  const kickoff = row.match?.matchDateTimeUTC?.toISOString();
  const status = (row.match?.status ?? "").toLowerCase() || "scheduled";
  const baseItem: Omit<ExpandedPredictionItem, "predictionType" | "marketKey" | "probabilities"> = {
    matchId: row.matchId,
    modelVersionId: row.modelVersionId ?? null,
    expectedScore: {
      home: Number(expected.home.toFixed(2)),
      away: Number(expected.away.toFixed(2))
    },
    commentary: sharedCommentary,
    supportingSignals: [
      { key: "expected_total", label: "Beklenen Toplam Sayi", value: expected.expectedTotal.toFixed(1) },
      { key: "expected_spread", label: "Beklenen Handikap (Ev)", value: expected.expectedSpreadHome.toFixed(1) }
    ],
    contradictionSignals: riskFlags.map((flag, index) => ({
      key: `risk_${index}`,
      label: flag.code,
      detail: flag.message
    })),
    riskFlags,
    confidenceScore: confidence,
    summary,
    avoidReason: row.avoidReason,
    updatedAt: row.updatedAt.toISOString(),
    matchStatus: status,
    homeScore: row.match?.homeScore ?? null,
    awayScore: row.match?.awayScore ?? null,
    halfTimeHomeScore: row.match?.halfTimeHomeScore ?? null,
    halfTimeAwayScore: row.match?.halfTimeAwayScore ?? null,
    isPlayed: status === "finished",
    homeTeam: row.match?.homeTeam?.name,
    awayTeam: row.match?.awayTeam?.name,
    matchDateTimeUTC: kickoff
  };

  const firstHalfBaseHome = clampProbability(outcome.home * 0.86 + 0.03);
  const firstHalfBaseAway = clampProbability(outcome.away * 0.86 + 0.03);
  const firstHalfDraw = clampProbability(1 - firstHalfBaseHome - firstHalfBaseAway);

  return [
    {
      ...baseItem,
      predictionType: "fullTimeResult",
      marketKey: "moneyline",
      probabilities: outcome
    },
    {
      ...baseItem,
      predictionType: "firstHalfResult",
      marketKey: "first_half_moneyline",
      probabilities: {
        home: round4(firstHalfBaseHome),
        draw: round4(firstHalfDraw),
        away: round4(firstHalfBaseAway)
      },
      confidenceScore: round4(Math.max(0.28, confidence - 0.04))
    },
    ...totalLines.map((line) => ({
      ...baseItem,
      predictionType: "totalGoalsOverUnder" as const,
      marketKey: `total_points_${line.line}`,
      selectionLabel: `Toplam Sayi ${line.line}`,
      line: Number(line.line.toFixed(1)),
      probabilities: {
        over: line.over,
        under: line.under
      },
      confidenceScore: round4(Math.max(0.3, confidence - 0.02))
    })),
    {
      ...baseItem,
      predictionType: "firstHalfGoals",
      marketKey: "first_half_total_points",
      selectionLabel: "Ilk Yari Toplam Sayi",
      line: Number((Math.round(expected.firstHalfTotal / 0.5) * 0.5).toFixed(1)),
      probabilities: {
        over: round4(lineOverProbability(expected.firstHalfTotal, expected.firstHalfTotal - 0.5)),
        under: round4(1 - lineOverProbability(expected.firstHalfTotal, expected.firstHalfTotal - 0.5))
      },
      confidenceScore: round4(Math.max(0.3, confidence - 0.05))
    },
    {
      ...baseItem,
      predictionType: "secondHalfGoals",
      marketKey: "second_half_total_points",
      selectionLabel: "Ikinci Yari Toplam Sayi",
      line: Number((Math.round(expected.secondHalfTotal / 0.5) * 0.5).toFixed(1)),
      probabilities: {
        over: round4(lineOverProbability(expected.secondHalfTotal, expected.secondHalfTotal - 0.5)),
        under: round4(1 - lineOverProbability(expected.secondHalfTotal, expected.secondHalfTotal - 0.5))
      },
      confidenceScore: round4(Math.max(0.3, confidence - 0.05))
    }
  ];
}
