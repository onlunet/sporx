import { Injectable } from "@nestjs/common";
import { MatchStatus } from "@prisma/client";
import { BasketballCalibrationService } from "./basketball-calibration.service";
import { BasketballEnsembleService } from "./basketball-ensemble.service";
import { BasketballFeatureEngineeringService } from "./basketball-feature-engineering.service";
import { BasketballMarketAdjustmentService } from "./basketball-market-adjustment.service";
import { BasketballPossessionModelService } from "./basketball-possession-model.service";
import { BasketballRatingModelService } from "./basketball-rating-model.service";
import { BasketballRiskFlag } from "./basketball-feature.types";

export type BasketballPredictionGenerationInput = {
  matchId: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
  kickoffAt: Date;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  now: Date;
};

export type BasketballPredictionGenerationResult = {
  rawProbabilities: { home: number; draw: number; away: number };
  calibratedProbabilities: { home: number; draw: number; away: number };
  rawConfidenceScore: number;
  calibratedConfidenceScore: number;
  confidenceScore: number;
  expectedScore: Record<string, unknown>;
  summary: string;
  riskFlags: BasketballRiskFlag[];
  isLowConfidence: boolean;
  avoidReason: string | null;
  isRecommended: boolean;
};

@Injectable()
export class BasketballPredictionEngineService {
  constructor(
    private readonly featureEngineering: BasketballFeatureEngineeringService,
    private readonly possessionModel: BasketballPossessionModelService,
    private readonly ratingModel: BasketballRatingModelService,
    private readonly marketAdjustment: BasketballMarketAdjustmentService,
    private readonly ensemble: BasketballEnsembleService,
    private readonly calibration: BasketballCalibrationService
  ) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private appendUniqueRiskFlags(
    base: BasketballRiskFlag[],
    additional: BasketballRiskFlag[]
  ): BasketballRiskFlag[] {
    const seen = new Set(base.map((flag) => `${flag.code}|${flag.severity}`));
    const merged = [...base];
    for (const flag of additional) {
      const key = `${flag.code}|${flag.severity}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      merged.push(flag);
    }
    return merged;
  }

  async compute(input: BasketballPredictionGenerationInput): Promise<BasketballPredictionGenerationResult> {
    const features = await this.featureEngineering.build({
      matchId: input.matchId,
      leagueId: input.leagueId,
      homeTeamId: input.homeTeamId,
      awayTeamId: input.awayTeamId,
      kickoffAt: input.kickoffAt
    });
    const possession = this.possessionModel.project(features);
    const core = this.ratingModel.project(features, possession);
    const market = await this.marketAdjustment.loadSnapshot(input.matchId, input.now);
    const blended = this.ensemble.blend(core, market, features);

    let riskFlags = [...blended.riskFlags];
    if (features.context.lineupCertaintyScore < 0.58) {
      riskFlags = this.appendUniqueRiskFlags(riskFlags, [
        {
          code: "MAJOR_LINEUP_UNCERTAINTY",
          severity: "high",
          message: "Kadro netligi dusuk. Rotasyon belirsizligi tahmini zayiflatabilir."
        }
      ]);
    }
    if (features.context.scheduleFatigueScore > 0.62) {
      riskFlags = this.appendUniqueRiskFlags(riskFlags, [
        {
          code: "BACK_TO_BACK_FATIGUE",
          severity: "medium",
          message: "Yorgunluk sinyali belirgin. Tempoda dalgalanma beklenebilir."
        }
      ]);
    }
    if (features.sampleQualityScore < 0.36) {
      riskFlags = this.appendUniqueRiskFlags(riskFlags, [
        {
          code: "LEAGUE_DATA_QUALITY_LOW",
          severity: "medium",
          message: "Veri kapsam kalitesi sinirli. Sonuc olasiliklari temkinli degerlendirilmeli."
        }
      ]);
    }

    const calibratedProbabilities = this.calibration.calibrateOutcome(blended.outcomeProbabilities);
    const calibratedTotals = blended.totalLineProbabilities.map((line) => ({
      line: line.line,
      ...this.calibration.calibrateBinary(line.over)
    }));

    const rawConfidenceScore = this.calibration.confidence(blended.outcomeProbabilities, riskFlags);
    const calibratedConfidenceScore = this.calibration.confidence(calibratedProbabilities, riskFlags);
    const confidenceScore = Number(
      this.clamp(calibratedConfidenceScore * 0.82 + features.sampleQualityScore * 0.18, 0.22, 0.92).toFixed(4)
    );

    const isLowConfidence = confidenceScore < 0.57;
    const avoidReason =
      isLowConfidence && features.context.lineupCertaintyScore < 0.58
        ? "Kadro ve rotasyon belirsizligi nedeniyle model guven seviyesi dusuk."
        : isLowConfidence
        ? "Tahmin guven skoru hedef esigin altinda."
        : riskFlags.some((flag) => flag.severity === "high")
        ? "Yuksek risk sinyalleri nedeniyle tahmin temkinli degerlendirilmeli."
        : null;

    const expectedScore = {
      home: core.homeExpectedPoints,
      away: core.awayExpectedPoints,
      expectedPossessions: possession.expectedPossessions,
      paceBucket: possession.paceBucket,
      expectedTotal: core.expectedTotal,
      expectedSpreadHome: core.expectedSpreadHome,
      firstHalfTotal: core.projectedFirstHalfTotal,
      secondHalfTotal: core.projectedSecondHalfTotal,
      totalLines: calibratedTotals,
      marketAgreementLevel: blended.marketAgreementLevel,
      marketCoverageScore: market.coverageScore
    };

    const summary = `${input.homeTeamName} vs ${input.awayTeamName}: Ev kazanir %${Math.round(
      calibratedProbabilities.home * 100
    )}, Dep kazanir %${Math.round(calibratedProbabilities.away * 100)}. Beklenen skor ${core.homeExpectedPoints.toFixed(
      1
    )}-${core.awayExpectedPoints.toFixed(1)}.`;

    return {
      rawProbabilities: blended.outcomeProbabilities,
      calibratedProbabilities,
      rawConfidenceScore,
      calibratedConfidenceScore,
      confidenceScore,
      expectedScore,
      summary,
      riskFlags,
      isLowConfidence,
      avoidReason,
      isRecommended: confidenceScore >= 0.62 && !isLowConfidence && riskFlags.every((flag) => flag.severity !== "high")
    };
  }
}
