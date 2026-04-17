import { Injectable, Logger } from "@nestjs/common";
import { MatchStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

type RecordShadowComparisonInput = {
  matchId: string;
  market: string;
  line?: number | null;
  horizon: string;
  selection?: string | null;
  predictionRunId: string;
  newProbability: number;
  newConfidence: number;
  calibrationBins?: unknown;
  coverage?: Record<string, unknown> | null;
  duplicateSuppressed?: boolean;
  leakageViolation?: boolean;
  latencyMsNew?: number | null;
  details?: Record<string, unknown>;
};

@Injectable()
export class ShadowEvaluationService {
  private readonly logger = new Logger(ShadowEvaluationService.name);

  constructor(private readonly prisma: PrismaService) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private round(value: number, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private asRecord(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private asNumber(value: unknown) {
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

  private lineKey(line?: number | null) {
    if (line === null || line === undefined || !Number.isFinite(line)) {
      return "na";
    }
    return Number(line).toFixed(2);
  }

  private normalizeSelection(selection: string | null | undefined) {
    const token = (selection ?? "").trim().toLowerCase();
    if (["home", "h", "1"].includes(token)) {
      return "home";
    }
    if (["draw", "x", "d"].includes(token)) {
      return "draw";
    }
    if (["away", "a", "2"].includes(token)) {
      return "away";
    }
    if (["yes", "y"].includes(token)) {
      return "yes";
    }
    if (["no", "n"].includes(token)) {
      return "no";
    }
    if (["over", "o"].includes(token)) {
      return "over";
    }
    if (["under", "u"].includes(token)) {
      return "under";
    }
    return token.length > 0 ? token : "home";
  }

  private resolveBinaryActual(
    market: string,
    selection: string,
    line: number | null,
    match: { homeScore: number | null; awayScore: number | null; halfTimeHomeScore: number | null; halfTimeAwayScore: number | null }
  ) {
    const marketToken = market.toLowerCase();
    if (marketToken === "match_outcome" || marketToken === "match_result" || marketToken === "moneyline") {
      if (match.homeScore === null || match.awayScore === null) {
        return null;
      }
      const outcome = match.homeScore > match.awayScore ? "home" : match.homeScore < match.awayScore ? "away" : "draw";
      return outcome === selection ? 1 : 0;
    }
    if (marketToken === "both_teams_to_score" || marketToken === "btts") {
      if (match.homeScore === null || match.awayScore === null) {
        return null;
      }
      const yes = match.homeScore > 0 && match.awayScore > 0;
      return selection === "yes" ? (yes ? 1 : 0) : yes ? 0 : 1;
    }
    if (marketToken === "total_goals_over_under" || marketToken === "total_goals") {
      if (match.homeScore === null || match.awayScore === null || line === null) {
        return null;
      }
      const total = match.homeScore + match.awayScore;
      const over = total > line;
      return selection === "over" ? (over ? 1 : 0) : over ? 0 : 1;
    }
    if (marketToken === "first_half_result") {
      if (match.halfTimeHomeScore === null || match.halfTimeAwayScore === null) {
        return null;
      }
      const outcome =
        match.halfTimeHomeScore > match.halfTimeAwayScore
          ? "home"
          : match.halfTimeHomeScore < match.halfTimeAwayScore
            ? "away"
            : "draw";
      return outcome === selection ? 1 : 0;
    }
    return null;
  }

  private binaryLoss(probability: number, actual: number | null) {
    if (actual === null) {
      return { logLoss: null, brier: null };
    }
    const p = this.clamp(probability, 1e-6, 1 - 1e-6);
    const logLoss = -(actual * Math.log(p) + (1 - actual) * Math.log(1 - p));
    const brier = (p - actual) ** 2;
    return {
      logLoss: this.round(logLoss),
      brier: this.round(brier)
    };
  }

  async recordComparison(input: RecordShadowComparisonInput) {
    const normalizedSelection = this.normalizeSelection(input.selection);
    const lineKey = this.lineKey(input.line);

    const [legacyPrediction, match] = await Promise.all([
      this.prisma.prediction.findUnique({
        where: { matchId: input.matchId },
        select: {
          probabilities: true,
          calibratedProbabilities: true,
          confidenceScore: true
        }
      }),
      this.prisma.match.findUnique({
        where: { id: input.matchId },
        select: {
          status: true,
          homeScore: true,
          awayScore: true,
          halfTimeHomeScore: true,
          halfTimeAwayScore: true
        }
      })
    ]);

    if (!match) {
      return null;
    }

    const legacyProbs =
      this.asRecord(legacyPrediction?.calibratedProbabilities) ?? this.asRecord(legacyPrediction?.probabilities);
    const oldProbabilityCandidate = this.asNumber(legacyProbs?.[normalizedSelection]);
    const oldProbability = oldProbabilityCandidate === null ? null : this.clamp(oldProbabilityCandidate, 0.0001, 0.9999);
    const oldConfidence =
      legacyPrediction && Number.isFinite(legacyPrediction.confidenceScore)
        ? this.clamp(legacyPrediction.confidenceScore, 0, 1)
        : null;

    const actual = this.resolveBinaryActual(input.market, normalizedSelection, input.line ?? null, match);
    const newLoss = this.binaryLoss(input.newProbability, actual);
    const oldLoss = oldProbability === null ? { logLoss: null, brier: null } : this.binaryLoss(oldProbability, actual);
    const leakageViolation =
      Boolean(input.leakageViolation) ||
      (match.status === MatchStatus.scheduled && actual !== null && actual !== undefined);

    try {
      return await this.prisma.shadowPredictionComparison.upsert({
        where: {
          matchId_market_lineKey_horizon: {
            matchId: input.matchId,
            market: input.market,
            lineKey,
            horizon: input.horizon
          }
        },
        update: {
          line: input.line ?? null,
          oldProbability,
          newProbability: this.round(input.newProbability),
          oldConfidence,
          newConfidence: this.round(input.newConfidence),
          oldLogLoss: oldLoss.logLoss,
          newLogLoss: newLoss.logLoss,
          oldBrier: oldLoss.brier,
          newBrier: newLoss.brier,
          calibrationBins: (input.calibrationBins ?? null) as Prisma.InputJsonValue,
          coverage: (input.coverage ?? null) as Prisma.InputJsonValue,
          latencyMsOld: null,
          latencyMsNew: input.latencyMsNew ?? null,
          duplicateSuppressed: Boolean(input.duplicateSuppressed),
          leakageViolation,
          details: {
            selection: normalizedSelection,
            actualLabel: actual,
            ...(input.details ?? {})
          } as Prisma.InputJsonValue,
          predictionRunId: input.predictionRunId,
          createdAt: new Date()
        },
        create: {
          matchId: input.matchId,
          market: input.market,
          line: input.line ?? null,
          lineKey,
          horizon: input.horizon,
          oldProbability,
          newProbability: this.round(input.newProbability),
          oldConfidence,
          newConfidence: this.round(input.newConfidence),
          oldLogLoss: oldLoss.logLoss,
          newLogLoss: newLoss.logLoss,
          oldBrier: oldLoss.brier,
          newBrier: newLoss.brier,
          calibrationBins: (input.calibrationBins ?? null) as Prisma.InputJsonValue,
          coverage: (input.coverage ?? null) as Prisma.InputJsonValue,
          latencyMsOld: null,
          latencyMsNew: input.latencyMsNew ?? null,
          duplicateSuppressed: Boolean(input.duplicateSuppressed),
          leakageViolation,
          details: {
            selection: normalizedSelection,
            actualLabel: actual,
            ...(input.details ?? {})
          } as Prisma.InputJsonValue,
          predictionRunId: input.predictionRunId
        }
      });
    } catch (error) {
      this.logger.warn(
        `shadow comparison write skipped for ${input.matchId}/${input.market}/${input.horizon}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      return null;
    }
  }
}
