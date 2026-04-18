import { Body, Controller, Get, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ManualOverrideAction, MatchStatus, Prisma, PublishDecisionStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PipelineRolloutService } from "../predictions/pipeline-rollout.service";
import { SelectionEngineConfigService } from "../predictions/selection-engine-config.service";

type PredictionTypeKey =
  | "fullTimeResult"
  | "firstHalfResult"
  | "halfTimeFullTime"
  | "bothTeamsToScore"
  | "totalGoalsOverUnder"
  | "correctScore"
  | "goalRange"
  | "firstHalfGoals"
  | "secondHalfGoals"
  | "unknown";

type TrendDirection = "up" | "down" | "flat";

type ParsedPrediction = {
  predictionType: PredictionTypeKey;
  line: number | null;
  predictedLabel: string | null;
  probabilities: Record<string, number>;
  confidence: number;
  createdAt: Date;
};

type ScoredPrediction = ParsedPrediction & {
  actualLabel: string | null;
  isCorrect: boolean | null;
  logLoss: number | null;
  brierScore: number | null;
};

@Controller("admin/predictions")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminPredictionsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rolloutService: PipelineRolloutService,
    private readonly selectionEngineConfigService: SelectionEngineConfigService
  ) {}

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private asNumber(value: unknown): number | null {
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

  private clamp(value: number, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  private round(value: number, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private avg(values: number[]) {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private std(values: number[]) {
    if (values.length <= 1) {
      return 0;
    }
    const mean = this.avg(values);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private parseTake(value: string | undefined, fallback = 100, max = 5000) {
    if (!value) {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(1, Math.min(max, Math.floor(parsed)));
  }

  private parseLookbackDays(value: string | undefined, fallback = 120) {
    if (!value) {
      return fallback;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }
    return Math.max(1, Math.min(730, Math.floor(parsed)));
  }

  private lineKey(line: number | null | undefined) {
    if (line === null || line === undefined || !Number.isFinite(line)) {
      return "na";
    }
    return Number(line).toFixed(2);
  }

  private normalizeSelection(token: string | null | undefined) {
    const normalized = (token ?? "").trim().toLowerCase();
    if (["home", "h", "1"].includes(normalized)) {
      return "home";
    }
    if (["draw", "x", "d"].includes(normalized)) {
      return "draw";
    }
    if (["away", "a", "2"].includes(normalized)) {
      return "away";
    }
    if (["yes", "y"].includes(normalized)) {
      return "yes";
    }
    if (["no", "n"].includes(normalized)) {
      return "no";
    }
    if (["over", "o"].includes(normalized)) {
      return "over";
    }
    if (["under", "u"].includes(normalized)) {
      return "under";
    }
    return normalized;
  }

  private toPredictionType(market: string): PredictionTypeKey {
    const normalized = market.trim().toLowerCase();
    if (["match_outcome", "match_result", "moneyline", "full_time_result"].includes(normalized)) {
      return "fullTimeResult";
    }
    if (["first_half_result", "firsthalfresult"].includes(normalized)) {
      return "firstHalfResult";
    }
    if (["half_time_full_time", "half_time_fulltime", "htft"].includes(normalized)) {
      return "halfTimeFullTime";
    }
    if (["both_teams_to_score", "btts"].includes(normalized)) {
      return "bothTeamsToScore";
    }
    if (["total_goals_over_under", "total_goals", "over_under", "totals"].includes(normalized)) {
      return "totalGoalsOverUnder";
    }
    if (["correct_score", "correctscore"].includes(normalized)) {
      return "correctScore";
    }
    if (["goal_range", "goalrange"].includes(normalized)) {
      return "goalRange";
    }
    if (["first_half_goals", "firsthalfgoals"].includes(normalized)) {
      return "firstHalfGoals";
    }
    if (["second_half_goals", "secondhalfgoals"].includes(normalized)) {
      return "secondHalfGoals";
    }
    return "unknown";
  }

  private parseRunPrediction(run: {
    market: string;
    line: number | null;
    probability: number;
    confidence: number;
    explanationJson: Prisma.JsonValue;
    createdAt: Date;
  }): ParsedPrediction {
    const explanation = this.asRecord(run.explanationJson);
    const selectedSideRaw = typeof explanation?.selectedSide === "string" ? explanation.selectedSide : null;
    const selectedSide = this.normalizeSelection(selectedSideRaw);
    const candidateMaps = [
      this.asRecord(explanation?.calibratedProbabilities),
      this.asRecord(explanation?.probabilities),
      this.asRecord(explanation?.rawProbabilities)
    ].filter(Boolean) as Array<Record<string, unknown>>;

    let probabilities: Record<string, number> = {};
    for (const map of candidateMaps) {
      const next: Record<string, number> = {};
      for (const [key, value] of Object.entries(map)) {
        const num = this.asNumber(value);
        if (num === null) {
          continue;
        }
        next[key] = this.clamp(num, 0, 1);
      }
      if (Object.keys(next).length > 0) {
        probabilities = next;
        break;
      }
    }

    if (Object.keys(probabilities).length === 0) {
      if (selectedSide && selectedSide.length > 0) {
        const p = this.clamp(run.probability, 0.0001, 0.9999);
        probabilities = { [selectedSide]: p, opposite: this.round(1 - p, 6) };
      } else {
        probabilities = {
          home: 0.34,
          draw: 0.33,
          away: 0.33
        };
      }
    }

    const sorted = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
    const predictedLabel = sorted[0]?.[0] ?? selectedSide ?? null;

    return {
      predictionType: this.toPredictionType(run.market),
      line: run.line ?? null,
      predictedLabel,
      probabilities,
      confidence: this.clamp(run.confidence, 0, 1),
      createdAt: run.createdAt
    };
  }

  private actualLabelFor(type: PredictionTypeKey, line: number | null, match: {
    homeScore: number | null;
    awayScore: number | null;
    halfTimeHomeScore: number | null;
    halfTimeAwayScore: number | null;
  }) {
    if (type === "fullTimeResult") {
      if (match.homeScore === null || match.awayScore === null) {
        return null;
      }
      if (match.homeScore > match.awayScore) {
        return "home";
      }
      if (match.homeScore < match.awayScore) {
        return "away";
      }
      return "draw";
    }

    if (type === "firstHalfResult") {
      if (match.halfTimeHomeScore === null || match.halfTimeAwayScore === null) {
        return null;
      }
      if (match.halfTimeHomeScore > match.halfTimeAwayScore) {
        return "home";
      }
      if (match.halfTimeHomeScore < match.halfTimeAwayScore) {
        return "away";
      }
      return "draw";
    }

    if (type === "bothTeamsToScore") {
      if (match.homeScore === null || match.awayScore === null) {
        return null;
      }
      return match.homeScore > 0 && match.awayScore > 0 ? "yes" : "no";
    }

    if (type === "totalGoalsOverUnder") {
      if (match.homeScore === null || match.awayScore === null || line === null) {
        return null;
      }
      const total = match.homeScore + match.awayScore;
      return total > line ? "over" : "under";
    }

    if (type === "correctScore") {
      if (match.homeScore === null || match.awayScore === null) {
        return null;
      }
      return `${match.homeScore}-${match.awayScore}`;
    }

    return null;
  }

  private brierAndLogLoss(probabilities: Record<string, number>, actualLabel: string | null) {
    if (!actualLabel) {
      return { brierScore: null, logLoss: null };
    }
    const keys = Object.keys(probabilities);
    if (keys.length === 0) {
      return { brierScore: null, logLoss: null };
    }
    const normalized: Record<string, number> = {};
    let sum = 0;
    for (const key of keys) {
      sum += Math.max(0, probabilities[key]);
    }
    const divisor = sum <= 0 ? 1 : sum;
    for (const key of keys) {
      normalized[key] = this.clamp(probabilities[key] / divisor, 0.000001, 0.999999);
    }

    const pActual = this.clamp(normalized[actualLabel] ?? 0.000001, 0.000001, 0.999999);
    const logLoss = -Math.log(pActual);
    const brier = keys.reduce((acc, key) => {
      const y = key === actualLabel ? 1 : 0;
      const p = normalized[key] ?? 0;
      return acc + (p - y) ** 2;
    }, 0) / keys.length;

    return {
      brierScore: this.round(brier),
      logLoss: this.round(logLoss)
    };
  }

  private toTrend(values: Array<number | null>): TrendDirection {
    const valid = values.filter((item): item is number => item !== null);
    if (valid.length < 3) {
      return "flat";
    }
    const head = valid.slice(0, Math.ceil(valid.length / 2));
    const tail = valid.slice(Math.floor(valid.length / 2));
    const delta = this.avg(tail) - this.avg(head);
    if (delta > 0.01) {
      return "up";
    }
    if (delta < -0.01) {
      return "down";
    }
    return "flat";
  }

  @Get("failed")
  failed(@Query("take") take?: string) {
    return this.prisma.failedPredictionAnalysis.findMany({
      orderBy: { createdAt: "desc" },
      take: this.parseTake(take, 200, 1000)
    });
  }

  @Get("low-confidence")
  async lowConfidence(@Query("take") take?: string, @Query("threshold") threshold?: string) {
    const maxRows = this.parseTake(take, 200, 1000);
    const poolTake = Math.min(maxRows * 5, 5000);
    const thresholdNum = this.asNumber(threshold);
    const confidenceThreshold = thresholdNum === null ? 0.55 : this.clamp(thresholdNum, 0.2, 0.95);

    const rows = await this.prisma.publishedPrediction.findMany({
      orderBy: { publishedAt: "desc" },
      take: poolTake,
      include: {
        predictionRun: {
          select: {
            id: true,
            matchId: true,
            market: true,
            line: true,
            horizon: true,
            confidence: true,
            riskFlagsJson: true,
            explanationJson: true,
            createdAt: true
          }
        }
      }
    });

    const normalized = rows
      .map((row) => {
        const riskFlags = Array.isArray(row.predictionRun.riskFlagsJson) ? row.predictionRun.riskFlagsJson : [];
        const hasLowConfidenceRisk = riskFlags.some((risk) => {
          const entry = this.asRecord(risk);
          const code = typeof entry?.code === "string" ? entry.code.toUpperCase() : "";
          return code.includes("LOW_CONF");
        });
        const hasBlockingRisk = riskFlags.some((risk) => {
          const entry = this.asRecord(risk);
          const severity = typeof entry?.severity === "string" ? entry.severity.toUpperCase() : "";
          return severity === "HIGH" || severity === "CRITICAL";
        });

        const explanation = this.asRecord(row.predictionRun.explanationJson);
        const summary =
          typeof explanation?.summary === "string"
            ? explanation.summary
            : `${row.predictionRun.market} ${row.predictionRun.horizon}`;
        const avoidReason =
          typeof explanation?.avoidReason === "string"
            ? explanation.avoidReason
            : typeof explanation?.reason === "string"
              ? explanation.reason
              : null;

        return {
          id: row.predictionRun.id,
          matchId: row.predictionRun.matchId,
          confidenceScore: this.round(this.clamp(row.predictionRun.confidence, 0, 1), 6),
          summary,
          riskFlags,
          avoidReason,
          isRecommended: row.predictionRun.confidence >= confidenceThreshold && !hasBlockingRisk,
          createdAt: row.predictionRun.createdAt,
          hasLowConfidenceRisk
        };
      })
      .filter((row) => row.hasLowConfidenceRisk || row.confidenceScore < confidenceThreshold)
      .sort((left, right) => left.confidenceScore - right.confidenceScore || right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, maxRows)
      .map(({ hasLowConfidenceRisk: _unused, ...row }) => row);

    return normalized;
  }

  @Get("by-type")
  async byType(
    @Query("take") take?: string,
    @Query("lookbackDays") lookbackDays?: string
  ) {
    const maxRows = this.parseTake(take, 2500, 15000);
    const days = this.parseLookbackDays(lookbackDays, 120);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.publishedPrediction.findMany({
      where: {
        publishedAt: { gte: from },
        match: {
          sport: { code: "football" },
          status: MatchStatus.finished
        }
      },
      include: {
        match: {
          select: {
            homeScore: true,
            awayScore: true,
            halfTimeHomeScore: true,
            halfTimeAwayScore: true
          }
        },
        predictionRun: {
          select: {
            market: true,
            line: true,
            probability: true,
            confidence: true,
            explanationJson: true,
            createdAt: true
          }
        }
      },
      orderBy: { publishedAt: "desc" },
      take: maxRows
    });

    const scored: ScoredPrediction[] = rows.map((row) => {
      const parsed = this.parseRunPrediction(row.predictionRun);
      const actualLabel = this.actualLabelFor(parsed.predictionType, parsed.line, row.match);
      const losses = this.brierAndLogLoss(parsed.probabilities, actualLabel);
      return {
        ...parsed,
        actualLabel,
        isCorrect:
          actualLabel === null || parsed.predictedLabel === null
            ? null
            : parsed.predictedLabel === actualLabel,
        logLoss: losses.logLoss,
        brierScore: losses.brierScore
      };
    });

    const bucket = new Map<string, ScoredPrediction[]>();
    for (const item of scored) {
      const key = `${item.predictionType}|${this.lineKey(item.line)}`;
      const list = bucket.get(key) ?? [];
      list.push(item);
      bucket.set(key, list);
    }

    const output = [...bucket.entries()].map(([key, items]) => {
      const [predictionType, lineKey] = key.split("|");
      const sampleSize = items.length;
      const accuracyValues = items
        .map((item) => item.isCorrect)
        .filter((item): item is boolean => item !== null);
      const logLossValues = items
        .map((item) => item.logLoss)
        .filter((item): item is number => item !== null);
      const brierValues = items
        .map((item) => item.brierScore)
        .filter((item): item is number => item !== null);
      const confidenceValues = items.map((item) => item.confidence);
      const accuracy =
        accuracyValues.length === 0 ? null : this.round(accuracyValues.filter(Boolean).length / accuracyValues.length);
      const avgConfidenceScore = this.round(this.avg(confidenceValues));
      const logLoss = logLossValues.length === 0 ? null : this.round(this.avg(logLossValues));
      const brierScore = brierValues.length === 0 ? null : this.round(this.avg(brierValues));
      const calibrationQuality =
        accuracy === null ? null : this.round(this.clamp(1 - Math.abs(avgConfidenceScore - accuracy), 0, 1));
      const varianceScore = this.round(this.std(confidenceValues));
      const timeline = items
        .slice()
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
        .map((item) => item.isCorrect === null ? null : item.isCorrect ? 1 : 0);

      return {
        predictionType,
        line: lineKey === "na" ? null : Number(lineKey),
        sampleSize,
        accuracy,
        logLoss,
        brierScore,
        avgConfidenceScore,
        calibrationQuality,
        varianceScore,
        trendDirection: this.toTrend(timeline),
        status:
          sampleSize < 12
            ? "watch"
            : (accuracy ?? 0) >= 0.58 && (varianceScore ?? 0) < 0.2
              ? "strong"
              : (accuracy ?? 0) >= 0.53
                ? "stable"
                : "weak",
        updatedAt: items[0]?.createdAt?.toISOString?.() ?? null
      };
    });

    return output.sort((a, b) => b.sampleSize - a.sampleSize);
  }

  @Get("high-variance")
  async highVariance(@Query("take") take?: string) {
    const maxRows = this.parseTake(take, 200, 1000);
    const rows = await this.prisma.publishedPrediction.findMany({
      where: {
        match: {
          sport: { code: "football" }
        }
      },
      include: {
        predictionRun: {
          select: {
            market: true,
            line: true,
            confidence: true,
            riskFlagsJson: true
          }
        }
      },
      orderBy: { publishedAt: "desc" },
      take: maxRows
    });

    const counter = new Map<string, { predictionType: string; issueCategory: string; count: number; note: string }>();
    for (const row of rows) {
      const predictionType = this.toPredictionType(row.predictionRun.market);
      const riskFlags = Array.isArray(row.predictionRun.riskFlagsJson) ? row.predictionRun.riskFlagsJson : [];
      for (const risk of riskFlags) {
        const rec = this.asRecord(risk);
        const code = typeof rec?.code === "string" && rec.code.length > 0 ? rec.code : "UNKNOWN";
        const message =
          typeof rec?.message === "string" && rec.message.length > 0 ? rec.message : "Risk flag";
        const key = `${predictionType}|${code}`;
        const current = counter.get(key) ?? {
          predictionType,
          issueCategory: code,
          count: 0,
          note: message
        };
        current.count += 1;
        counter.set(key, current);
      }

      if (row.predictionRun.confidence < 0.5) {
        const key = `${predictionType}|LOW_CONFIDENCE`;
        const current = counter.get(key) ?? {
          predictionType,
          issueCategory: "LOW_CONFIDENCE",
          count: 0,
          note: "Confidence 0.50 altindaki tahminler."
        };
        current.count += 1;
        counter.set(key, current);
      }
    }

    return [...counter.values()].sort((a, b) => b.count - a.count).slice(0, 100);
  }

  @Get("shadow/comparison")
  async shadowComparison(
    @Query("take") take?: string,
    @Query("market") market?: string,
    @Query("horizon") horizon?: string
  ) {
    const maxRows = this.parseTake(take, 500, 5000);
    const rows = await this.prisma.shadowPredictionComparison.findMany({
      where: {
        ...(market ? { market } : {}),
        ...(horizon ? { horizon } : {})
      },
      orderBy: { createdAt: "desc" },
      take: maxRows
    });

    const oldLogLoss = rows.map((row) => row.oldLogLoss).filter((item): item is number => item !== null);
    const newLogLoss = rows.map((row) => row.newLogLoss).filter((item): item is number => item !== null);
    const oldBrier = rows.map((row) => row.oldBrier).filter((item): item is number => item !== null);
    const newBrier = rows.map((row) => row.newBrier).filter((item): item is number => item !== null);
    const latencyNew = rows.map((row) => row.latencyMsNew).filter((item): item is number => item !== null);
    const duplicateSuppressed = rows.filter((row) => row.duplicateSuppressed).length;
    const leakageViolations = rows.filter((row) => row.leakageViolation).length;
    const withCoverage = rows.filter((row) => this.asRecord(row.coverage));
    const withOddsCoverage = withCoverage.filter((row) => {
      const coverage = this.asRecord(row.coverage);
      return Boolean(coverage?.has_odds);
    }).length;

    return {
      summary: {
        sampleSize: rows.length,
        coverageRate: rows.length === 0 ? 0 : this.round(withCoverage.length / rows.length, 4),
        oddsCoverageRate: rows.length === 0 ? 0 : this.round(withOddsCoverage / rows.length, 4),
        duplicateRate: rows.length === 0 ? 0 : this.round(duplicateSuppressed / rows.length, 4),
        leakageRate: rows.length === 0 ? 0 : this.round(leakageViolations / rows.length, 4),
        avgLatencyMsNew: latencyNew.length === 0 ? null : this.round(this.avg(latencyNew), 2),
        avgOldLogLoss: oldLogLoss.length === 0 ? null : this.round(this.avg(oldLogLoss)),
        avgNewLogLoss: newLogLoss.length === 0 ? null : this.round(this.avg(newLogLoss)),
        avgOldBrier: oldBrier.length === 0 ? null : this.round(this.avg(oldBrier)),
        avgNewBrier: newBrier.length === 0 ? null : this.round(this.avg(newBrier))
      },
      rows
    };
  }

  @Get("shadow/leakage")
  async leakage(@Query("take") take?: string) {
    const maxRows = this.parseTake(take, 500, 5000);
    const rows = await this.prisma.leakageCheckResult.findMany({
      orderBy: { createdAt: "desc" },
      take: maxRows
    });

    const violations = rows.filter((row) => !row.passed).length;
    const sourceLeaks = rows.reduce((sum, row) => sum + row.sourceLeakRows, 0);
    const oddsLeaks = rows.reduce((sum, row) => sum + row.oddsLeakRows, 0);

    return {
      summary: {
        checks: rows.length,
        violations,
        violationRate: rows.length === 0 ? 0 : this.round(violations / rows.length, 4),
        sourceLeakRows: sourceLeaks,
        oddsLeakRows: oddsLeaks
      },
      rows
    };
  }

  @Get("shadow/publish-failures")
  async publishFailures(@Query("take") take?: string) {
    const maxRows = this.parseTake(take, 300, 2000);
    const [rows, grouped] = await Promise.all([
      this.prisma.publishFailureLog.findMany({
        orderBy: { createdAt: "desc" },
        take: maxRows
      }),
      this.prisma.publishFailureLog.groupBy({
        by: ["errorCode"],
        _count: { _all: true },
        orderBy: { _count: { errorCode: "desc" } },
        take: 50
      })
    ]);

    return {
      summary: {
        totalFailures: rows.length
      },
      reasons: grouped.map((item) => ({
        errorCode: item.errorCode ?? "UNKNOWN",
        count: item._count._all
      })),
      rows
    };
  }

  @Get("shadow/duplicate-suppression")
  async duplicateSuppression(@Query("take") take?: string) {
    const maxRows = this.parseTake(take, 300, 2000);
    const rows = await this.prisma.duplicateSuppressionStat.findMany({
      orderBy: [{ suppressedCount: "desc" }, { lastSuppressedAt: "desc" }],
      take: maxRows
    });

    const totalSuppressed = rows.reduce((sum, row) => sum + row.suppressedCount, 0);
    return {
      summary: {
        dedupKeys: rows.length,
        totalSuppressed
      },
      rows
    };
  }

  @Get("meta-model/leaderboard")
  async metaModelLeaderboard(
    @Query("take") take?: string,
    @Query("lookbackDays") lookbackDays?: string,
    @Query("market") market?: string,
    @Query("horizon") horizon?: string
  ) {
    const maxRows = this.parseTake(take, 1500, 10000);
    const days = this.parseLookbackDays(lookbackDays, 60);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.metaModelRun.findMany({
      where: {
        createdAt: { gte: from },
        ...(market ? { market } : {}),
        ...(horizon ? { horizon } : {})
      },
      orderBy: { createdAt: "desc" },
      take: maxRows,
      select: {
        market: true,
        horizon: true,
        line: true,
        lineKey: true,
        modelVersion: true,
        coreProbability: true,
        refinedProbability: true,
        publishScore: true,
        riskAdjustedConfidence: true,
        isFallback: true,
        createdAt: true,
        match: {
          select: {
            league: { select: { name: true, code: true } }
          }
        }
      }
    });

    const groups = new Map<
      string,
      {
        market: string;
        horizon: string;
        lineKey: string;
        modelVersion: string;
        sampleSize: number;
        fallbackCount: number;
        core: number[];
        refined: number[];
        publish: number[];
        confidence: number[];
        leagues: Map<string, number>;
        updatedAt: Date;
      }
    >();

    for (const row of rows) {
      const key = `${row.market}|${row.horizon}|${row.lineKey}|${row.modelVersion}`;
      const current =
        groups.get(key) ??
        {
          market: row.market,
          horizon: row.horizon,
          lineKey: row.lineKey,
          modelVersion: row.modelVersion,
          sampleSize: 0,
          fallbackCount: 0,
          core: [],
          refined: [],
          publish: [],
          confidence: [],
          leagues: new Map<string, number>(),
          updatedAt: row.createdAt
        };
      current.sampleSize += 1;
      if (row.isFallback) {
        current.fallbackCount += 1;
      }
      current.core.push(row.coreProbability);
      current.refined.push(row.refinedProbability);
      current.publish.push(row.publishScore);
      current.confidence.push(row.riskAdjustedConfidence);
      if (row.createdAt.getTime() > current.updatedAt.getTime()) {
        current.updatedAt = row.createdAt;
      }
      const leagueName = row.match.league?.name ?? "Unknown";
      current.leagues.set(leagueName, (current.leagues.get(leagueName) ?? 0) + 1);
      groups.set(key, current);
    }

    const items = [...groups.values()].map((group) => ({
      market: group.market,
      horizon: group.horizon,
      line: group.lineKey === "na" ? null : Number(group.lineKey),
      modelVersion: group.modelVersion,
      sampleSize: group.sampleSize,
      fallbackRate: group.sampleSize === 0 ? 0 : this.round(group.fallbackCount / group.sampleSize, 4),
      avgCoreProbability: this.round(this.avg(group.core), 6),
      avgRefinedProbability: this.round(this.avg(group.refined), 6),
      avgPublishScore: this.round(this.avg(group.publish), 6),
      avgRiskAdjustedConfidence: this.round(this.avg(group.confidence), 6),
      topLeagues: [...group.leagues.entries()]
        .sort((left, right) => right[1] - left[1])
        .slice(0, 3)
        .map(([league, count]) => ({ league, count })),
      updatedAt: group.updatedAt.toISOString()
    }));

    return items.sort((left, right) => right.sampleSize - left.sampleSize);
  }

  @Get("meta-model/fallbacks")
  async metaModelFallbacks(@Query("take") take?: string, @Query("lookbackDays") lookbackDays?: string) {
    const maxRows = this.parseTake(take, 500, 5000);
    const days = this.parseLookbackDays(lookbackDays, 60);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.metaModelRun.findMany({
      where: {
        createdAt: { gte: from },
        isFallback: true
      },
      orderBy: { createdAt: "desc" },
      take: maxRows,
      select: {
        matchId: true,
        market: true,
        horizon: true,
        lineKey: true,
        fallbackReason: true,
        createdAt: true
      }
    });

    const byReason = new Map<string, number>();
    for (const row of rows) {
      const reason = row.fallbackReason && row.fallbackReason.length > 0 ? row.fallbackReason : "unknown";
      byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
    }

    return {
      summary: {
        totalFallbacks: rows.length
      },
      reasons: [...byReason.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((left, right) => right.count - left.count),
      rows
    };
  }

  @Get("meta-model/enrichment-coverage")
  async enrichmentCoverage(@Query("take") take?: string, @Query("lookbackDays") lookbackDays?: string) {
    const maxRows = this.parseTake(take, 1500, 10000);
    const days = this.parseLookbackDays(lookbackDays, 60);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [metaRows, providerCoverage, consensusRows] = await Promise.all([
      this.prisma.metaModelRun.findMany({
        where: { createdAt: { gte: from } },
        orderBy: { createdAt: "desc" },
        take: maxRows,
        select: {
          market: true,
          horizon: true,
          lineupSnapshotId: true,
          eventAggregateSnapshotId: true,
          marketConsensusSnapshotId: true,
          featureCoverageJson: true,
          match: {
            select: {
              league: { select: { id: true, name: true } }
            }
          }
        }
      }),
      this.prisma.canonicalLineup.groupBy({
        by: ["providerKey"],
        where: {
          pulledAt: { gte: from }
        },
        _count: { _all: true }
      }),
      this.prisma.marketConsensusSnapshot.findMany({
        where: { createdAt: { gte: from } },
        orderBy: { createdAt: "desc" },
        take: maxRows,
        select: {
          matchId: true,
          consensusJson: true
        }
      })
    ]);

    const byLeague = new Map<
      string,
      {
        leagueId: string | null;
        leagueName: string;
        sampleSize: number;
        lineupCoverage: number;
        eventCoverage: number;
        consensusCoverage: number;
      }
    >();

    for (const row of metaRows) {
      const leagueId = row.match.league?.id ?? null;
      const leagueName = row.match.league?.name ?? "Unknown";
      const key = leagueId ?? `unknown:${leagueName}`;
      const current =
        byLeague.get(key) ??
        {
          leagueId,
          leagueName,
          sampleSize: 0,
          lineupCoverage: 0,
          eventCoverage: 0,
          consensusCoverage: 0
        };
      current.sampleSize += 1;
      if (row.lineupSnapshotId) {
        current.lineupCoverage += 1;
      }
      if (row.eventAggregateSnapshotId) {
        current.eventCoverage += 1;
      }
      if (row.marketConsensusSnapshotId) {
        current.consensusCoverage += 1;
      }
      byLeague.set(key, current);
    }

    const volatilityRows = consensusRows
      .map((row) => {
        const consensus = this.asRecord(row.consensusJson);
        const summary = this.asRecord(consensus?.summary);
        const suspicious = this.asNumber(summary?.suspicious_volatility_rows) ?? 0;
        const total = this.asNumber(summary?.total_rows) ?? 0;
        return {
          suspicious,
          total
        };
      })
      .filter((item) => item.total > 0);

    return {
      summary: {
        sampleSize: metaRows.length,
        lineupCoverageRate:
          metaRows.length === 0 ? 0 : this.round(metaRows.filter((row) => Boolean(row.lineupSnapshotId)).length / metaRows.length, 4),
        eventCoverageRate:
          metaRows.length === 0 ? 0 : this.round(metaRows.filter((row) => Boolean(row.eventAggregateSnapshotId)).length / metaRows.length, 4),
        consensusCoverageRate:
          metaRows.length === 0 ? 0 : this.round(metaRows.filter((row) => Boolean(row.marketConsensusSnapshotId)).length / metaRows.length, 4),
        suspiciousConsensusRate:
          volatilityRows.length === 0
            ? 0
            : this.round(
                this.avg(volatilityRows.map((item) => item.suspicious / Math.max(1, item.total))),
                4
              )
      },
      byLeague: [...byLeague.values()]
        .map((row) => ({
          leagueId: row.leagueId,
          leagueName: row.leagueName,
          sampleSize: row.sampleSize,
          lineupCoverageRate: row.sampleSize === 0 ? 0 : this.round(row.lineupCoverage / row.sampleSize, 4),
          eventCoverageRate: row.sampleSize === 0 ? 0 : this.round(row.eventCoverage / row.sampleSize, 4),
          consensusCoverageRate: row.sampleSize === 0 ? 0 : this.round(row.consensusCoverage / row.sampleSize, 4)
        }))
        .sort((left, right) => right.sampleSize - left.sampleSize),
      providerCoverage: providerCoverage
        .map((row) => ({
          providerKey: row.providerKey ?? "unknown",
          lineupRows: row._count._all
        }))
        .sort((left, right) => right.lineupRows - left.lineupRows)
    };
  }

  @Get("rollout")
  async rolloutStatus() {
    const settings = await this.rolloutService.getSettings();
    const seeds = ["football:list:scheduled", "football:list:live", "football:match:detail", "football:high-confidence"];
    const sourcePreview = await Promise.all(
      seeds.map(async (seed) => ({
        seed,
        source: await this.rolloutService.resolveSource({ seed, isInternalRequest: false })
      }))
    );
    return {
      settings,
      sourcePreview
    };
  }

  @Patch("rollout")
  async updateRollout(
    @Body()
    body: {
      mode?: "legacy" | "new" | "shadow" | "percentage";
      percentage?: number;
      internalOnly?: boolean;
      emergencyRollback?: boolean;
    }
  ) {
    return this.rolloutService.setSettings({
      mode: body.mode,
      percentage: body.percentage,
      internalOnly: body.internalOnly,
      emergencyRollback: body.emergencyRollback
    });
  }

  @Get("selection/publish-rate")
  async selectionPublishRate(@Query("lookbackDays") lookbackDays?: string) {
    const days = this.parseLookbackDays(lookbackDays, 30);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.publishDecision.groupBy({
      by: ["strategyProfile", "status"],
      where: {
        createdAt: { gte: from }
      },
      _count: { _all: true }
    });

    const grouped = new Map<
      string,
      {
        strategyProfile: string;
        total: number;
        approved: number;
        abstained: number;
        suppressed: number;
        blocked: number;
        forced: number;
      }
    >();

    for (const row of rows) {
      const profile = row.strategyProfile ?? "BALANCED";
      const current =
        grouped.get(profile) ??
        {
          strategyProfile: profile,
          total: 0,
          approved: 0,
          abstained: 0,
          suppressed: 0,
          blocked: 0,
          forced: 0
        };

      current.total += row._count._all;
      if (row.status === PublishDecisionStatus.APPROVED) {
        current.approved += row._count._all;
      } else if (row.status === PublishDecisionStatus.ABSTAINED) {
        current.abstained += row._count._all;
      } else if (row.status === PublishDecisionStatus.SUPPRESSED) {
        current.suppressed += row._count._all;
      } else if (row.status === PublishDecisionStatus.BLOCKED) {
        current.blocked += row._count._all;
      } else if (row.status === PublishDecisionStatus.MANUALLY_FORCED) {
        current.forced += row._count._all;
      }
      grouped.set(profile, current);
    }

    return [...grouped.values()]
      .map((row) => ({
        ...row,
        publishRate: row.total === 0 ? 0 : this.round((row.approved + row.forced) / row.total, 4),
        abstainRate: row.total === 0 ? 0 : this.round(row.abstained / row.total, 4),
        suppressedRate: row.total === 0 ? 0 : this.round(row.suppressed / row.total, 4)
      }))
      .sort((left, right) => right.total - left.total);
  }

  @Get("selection/abstain-reasons")
  async selectionAbstainReasons(@Query("lookbackDays") lookbackDays?: string) {
    const days = this.parseLookbackDays(lookbackDays, 30);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await this.prisma.abstainReasonLog.groupBy({
      by: ["reasonCode", "severity"],
      where: {
        createdAt: { gte: from }
      },
      _count: { _all: true }
    });

    return rows
      .map((row) => ({
        reasonCode: row.reasonCode,
        severity: row.severity,
        count: row._count._all
      }))
      .sort((left, right) => right.count - left.count);
  }

  @Get("selection/funnel")
  async selectionFunnel(@Query("lookbackDays") lookbackDays?: string) {
    const days = this.parseLookbackDays(lookbackDays, 30);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [candidateCount, decisions, publishedCount] = await Promise.all([
      this.prisma.predictionCandidate.count({
        where: { createdAt: { gte: from } }
      }),
      this.prisma.publishDecision.groupBy({
        by: ["status"],
        where: { createdAt: { gte: from } },
        _count: { _all: true }
      }),
      this.prisma.publishedPrediction.count({
        where: {
          publishedAt: { gte: from },
          OR: [
            { publishDecision: { is: null } },
            { publishDecision: { is: { status: { in: [PublishDecisionStatus.APPROVED, PublishDecisionStatus.MANUALLY_FORCED] } } } }
          ]
        }
      })
    ]);

    const map = new Map(decisions.map((row) => [row.status, row._count._all]));
    return {
      candidates: candidateCount,
      decisions: {
        approved: map.get(PublishDecisionStatus.APPROVED) ?? 0,
        abstained: map.get(PublishDecisionStatus.ABSTAINED) ?? 0,
        suppressed: map.get(PublishDecisionStatus.SUPPRESSED) ?? 0,
        blocked: map.get(PublishDecisionStatus.BLOCKED) ?? 0,
        manuallyForced: map.get(PublishDecisionStatus.MANUALLY_FORCED) ?? 0
      },
      published: publishedCount
    };
  }

  @Get("selection/conflict-suppression")
  async selectionConflictSuppression(@Query("lookbackDays") lookbackDays?: string) {
    const days = this.parseLookbackDays(lookbackDays, 30);
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [suppressedCount, topReasons] = await Promise.all([
      this.prisma.publishDecision.count({
        where: {
          createdAt: { gte: from },
          status: PublishDecisionStatus.SUPPRESSED
        }
      }),
      this.prisma.abstainReasonLog.groupBy({
        by: ["reasonCode"],
        where: {
          createdAt: { gte: from },
          OR: [{ reasonCode: "CONFLICTING_CANDIDATE" }, { reasonCode: "DUPLICATE_CANDIDATE" }]
        },
        _count: { _all: true }
      })
    ]);

    return {
      suppressedCount,
      reasons: topReasons
        .map((row) => ({ reasonCode: row.reasonCode, count: row._count._all }))
        .sort((left, right) => right.count - left.count)
    };
  }

  @Get("selection/manual-overrides")
  async manualOverrides(@Query("take") take?: string) {
    const maxRows = this.parseTake(take, 200, 2000);
    return this.prisma.manualPublishOverride.findMany({
      orderBy: { createdAt: "desc" },
      take: maxRows,
      include: {
        actor: {
          select: { id: true, email: true }
        }
      }
    });
  }

  @Post("selection/manual-override")
  async createManualOverride(
    @Body()
    body: {
      matchId: string;
      market: string;
      line?: number | null;
      horizon: string;
      selection?: string | null;
      action: "FORCE" | "BLOCK";
      reason: string;
      actorUserId?: string | null;
      expiresAt?: string | null;
      active?: boolean;
    }
  ) {
    const line = this.asNumber(body.line ?? null);
    const lineKey = this.lineKey(line);
    const action = body.action === "FORCE" ? ManualOverrideAction.FORCE : ManualOverrideAction.BLOCK;
    const created = await this.prisma.manualPublishOverride.create({
      data: {
        matchId: body.matchId,
        market: body.market,
        line,
        lineKey,
        horizon: body.horizon,
        selection: body.selection ?? null,
        action,
        reason: body.reason,
        actorUserId: body.actorUserId ?? null,
        active: body.active ?? true,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : null
      }
    });

    await this.prisma.auditLog.create({
      data: {
        userId: body.actorUserId ?? null,
        action: action === ManualOverrideAction.FORCE ? "manual_force_publish" : "manual_block_publish",
        resourceType: "manual_publish_override",
        resourceId: created.id,
        metadata: {
          matchId: body.matchId,
          market: body.market,
          horizon: body.horizon,
          selection: body.selection ?? null
        } as Prisma.InputJsonValue
      }
    });

    return created;
  }

  @Post("selection/profile-override")
  async upsertProfileOverride(
    @Body()
    body: {
      profileKey: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
      leagueId?: string | null;
      market?: string | null;
      horizon?: string | null;
      config: Record<string, unknown>;
    }
  ) {
    return this.selectionEngineConfigService.upsertScopedProfile({
      profileKey: body.profileKey,
      leagueId: body.leagueId ?? null,
      market: body.market ?? null,
      horizon: body.horizon ?? null,
      config: body.config as any
    });
  }

  @Patch("selection/settings")
  async updateSelectionSettings(
    @Body()
    body: {
      enabled?: boolean;
      shadowMode?: boolean;
      defaultProfile?: "CONSERVATIVE" | "BALANCED" | "AGGRESSIVE";
      emergencyRollback?: boolean;
    }
  ) {
    return this.selectionEngineConfigService.setEngineSettings({
      enabled: body.enabled,
      shadowMode: body.shadowMode,
      defaultProfile: body.defaultProfile,
      emergencyRollback: body.emergencyRollback
    });
  }
}
