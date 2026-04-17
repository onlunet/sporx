import { Injectable } from "@nestjs/common";
import { Prisma, PromotionDecisionStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelAliasService } from "./model-alias.service";
import { PromotionEvaluationInput, PromotionEvaluationResult } from "./model-lifecycle.types";

type PersistPromotionDecisionInput = {
  sport: string;
  market: string;
  line?: number | null;
  horizon: string;
  leagueId?: string | null;
  championModelVersionId: string;
  challengerModelVersionId: string;
  championCalibrationVersionId?: string | null;
  challengerCalibrationVersionId?: string | null;
  challengerEvaluationId?: string | null;
  actor?: string | null;
  effectiveAt?: Date | null;
} & PromotionEvaluationInput;

@Injectable()
export class PromotionDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelAliasService: ModelAliasService
  ) {}

  evaluate(input: PromotionEvaluationInput): PromotionEvaluationResult {
    const reasons: string[] = [];
    const minimumSampleSizeMet = input.sampleSize >= input.minimumSampleSize;
    if (!minimumSampleSizeMet) {
      reasons.push(`insufficient_sample_size:${input.sampleSize}<${input.minimumSampleSize}`);
      return {
        status: PromotionDecisionStatus.EXTEND_SHADOW,
        reasons,
        minimumSampleSizeMet
      };
    }

    if (
      input.championLogLoss !== null &&
      input.challengerLogLoss !== null &&
      !(input.challengerLogLoss <= input.championLogLoss - input.minLogLossImprovement)
    ) {
      reasons.push("log_loss_not_improved");
    }
    if (
      input.championBrier !== null &&
      input.challengerBrier !== null &&
      !(input.challengerBrier <= input.championBrier - input.minBrierImprovement)
    ) {
      reasons.push("brier_not_improved");
    }
    if (
      input.championCalibrationDrift !== null &&
      input.challengerCalibrationDrift !== null &&
      input.challengerCalibrationDrift - input.championCalibrationDrift > input.maxCalibrationRegression
    ) {
      reasons.push("calibration_regression");
    }
    if (input.challengerLatencyP95Ms !== null && input.challengerLatencyP95Ms > input.maxLatencyP95Ms) {
      reasons.push("latency_limit_exceeded");
    }
    if (input.challengerFallbackRate !== null && input.challengerFallbackRate > input.maxFallbackRate) {
      reasons.push("fallback_rate_limit_exceeded");
    }
    if (input.challengerErrorRate !== null && input.challengerErrorRate > input.maxErrorRate) {
      reasons.push("error_rate_limit_exceeded");
    }

    if (reasons.length > 0) {
      return {
        status: PromotionDecisionStatus.KEEP_CHAMPION,
        reasons,
        minimumSampleSizeMet
      };
    }

    return {
      status: PromotionDecisionStatus.PROMOTE,
      reasons: ["challenger_beats_champion"],
      minimumSampleSizeMet
    };
  }

  async evaluateAndPersist(input: PersistPromotionDecisionInput) {
    const evaluation = this.evaluate(input);
    const sport = input.sport.trim().toLowerCase();
    const market = input.market.trim().toLowerCase();
    const line = input.line ?? null;
    const lineKey = this.modelAliasService.lineKey(line);
    const horizon = input.horizon.trim().toUpperCase();
    const scopeLeagueKey = this.modelAliasService.scopeLeagueKey(input.leagueId ?? null);

    const decision = await this.prisma.promotionDecision.create({
      data: {
        sportCode: sport,
        market,
        line,
        lineKey,
        horizon,
        leagueId: input.leagueId ?? null,
        scopeLeagueKey,
        championModelVersionId: input.championModelVersionId,
        challengerModelVersionId: input.challengerModelVersionId,
        championCalibrationVersionId: input.championCalibrationVersionId ?? null,
        challengerCalibrationVersionId: input.challengerCalibrationVersionId ?? null,
        challengerEvaluationId: input.challengerEvaluationId ?? null,
        status: evaluation.status,
        decisionReasons: {
          reasons: evaluation.reasons,
          sampleSize: input.sampleSize,
          minimumSampleSize: input.minimumSampleSize,
          metrics: {
            championLogLoss: input.championLogLoss,
            challengerLogLoss: input.challengerLogLoss,
            championBrier: input.championBrier,
            challengerBrier: input.challengerBrier,
            championCalibrationDrift: input.championCalibrationDrift,
            challengerCalibrationDrift: input.challengerCalibrationDrift,
            championLatencyP95Ms: input.championLatencyP95Ms,
            challengerLatencyP95Ms: input.challengerLatencyP95Ms,
            challengerFallbackRate: input.challengerFallbackRate,
            challengerErrorRate: input.challengerErrorRate
          }
        } as Prisma.InputJsonValue,
        actor: input.actor ?? "system",
        minimumSampleSizeMet: evaluation.minimumSampleSizeMet,
        effectiveAt: input.effectiveAt ?? null
      }
    });

    return {
      decision,
      evaluation
    };
  }
}
