import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

type CoverageInput = {
  hasOdds?: boolean;
  hasLineup?: boolean;
  hasEvent?: boolean;
  oddsCoverage?: number | null;
  lineupCoverage?: number | null;
  eventCoverage?: number | null;
  missingStatsRatio?: number | null;
};

export type CalibratePredictionInput = {
  market: string;
  horizon: string;
  rawProbability: number;
  line?: number | null;
  selection?: string | null;
  modelVersionId?: string | null;
  lookbackDays?: number;
  freshnessScore?: number | null;
  providerDisagreement?: number | null;
  volatilityScore?: number | null;
  coverage?: CoverageInput;
};

export type CalibratedPredictionOutput = {
  calibratedProbability: number;
  confidenceScore: number;
  calibration: {
    sampleSize: number;
    avgPredicted: number;
    empiricalRate: number;
    brierScore: number | null;
    logLoss: number | null;
    ece: number | null;
  };
  calibrationDiagnostics: {
    calibrationSampleSize: number;
    calibrationBucket: string;
    calibrationMethod: string;
    minSampleThreshold: number;
    marketProfile: string;
    correctionWeight: number;
    conservativePenalty: number;
  };
  riskFlags: Array<{ code: string; severity: "low" | "medium" | "high"; message: string }>;
};

export type CalibrationCurveInput = {
  market: string;
  horizon?: string;
  line?: number | null;
  selection?: string | null;
  modelVersionId?: string | null;
  bins?: number;
  lookbackDays?: number;
};

type CalibrationSample = {
  predicted: number;
  actual: number;
};

type CalibrationMarketConfig = {
  profile: string;
  minSampleThreshold: number;
  fullSampleTarget: number;
  maxCorrectionWeight: number;
  conservativePenalty: number;
};

const DEFAULT_MARKET_CONFIG: CalibrationMarketConfig = {
  profile: "standard",
  minSampleThreshold: 40,
  fullSampleTarget: 220,
  maxCorrectionWeight: 0.7,
  conservativePenalty: 0
};

const MARKET_CONFIG: Record<string, CalibrationMarketConfig> = {
  correct_score: {
    profile: "sparse_exact_score",
    minSampleThreshold: 180,
    fullSampleTarget: 600,
    maxCorrectionWeight: 0.32,
    conservativePenalty: 0.11
  },
  correctscore: {
    profile: "sparse_exact_score",
    minSampleThreshold: 180,
    fullSampleTarget: 600,
    maxCorrectionWeight: 0.32,
    conservativePenalty: 0.11
  },
  half_time_full_time: {
    profile: "derived_combo",
    minSampleThreshold: 120,
    fullSampleTarget: 420,
    maxCorrectionWeight: 0.42,
    conservativePenalty: 0.06
  },
  half_time_fulltime: {
    profile: "derived_combo",
    minSampleThreshold: 120,
    fullSampleTarget: 420,
    maxCorrectionWeight: 0.42,
    conservativePenalty: 0.06
  },
  htft: {
    profile: "derived_combo",
    minSampleThreshold: 120,
    fullSampleTarget: 420,
    maxCorrectionWeight: 0.42,
    conservativePenalty: 0.06
  },
  first_half_result: {
    profile: "early_window",
    minSampleThreshold: 80,
    fullSampleTarget: 300,
    maxCorrectionWeight: 0.5,
    conservativePenalty: 0.035
  },
  firsthalfresult: {
    profile: "early_window",
    minSampleThreshold: 80,
    fullSampleTarget: 300,
    maxCorrectionWeight: 0.5,
    conservativePenalty: 0.035
  }
};

@Injectable()
export class CalibrationService {
  constructor(private readonly prisma: PrismaService) {}

  private clamp(value: number, min: number, max: number) {
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

  private normalizeMarket(market: string) {
    return market.trim().toLowerCase();
  }

  private marketConfig(market: string) {
    return MARKET_CONFIG[this.normalizeMarket(market)] ?? DEFAULT_MARKET_CONFIG;
  }

  private bucketForProbability(probability: number, bins = 10) {
    const bucketCount = Math.max(4, Math.min(20, Math.floor(bins)));
    const idx = Math.min(bucketCount - 1, Math.floor(this.clamp(probability, 0, 0.999999) * bucketCount));
    const from = idx / bucketCount;
    const to = (idx + 1) / bucketCount;
    return `${from.toFixed(2)}-${to.toFixed(2)}`;
  }

  private normalizeSelection(selection: string | null | undefined, market: string) {
    const token = (selection ?? "").trim().toLowerCase();
    if (token.length === 0) {
      if (this.normalizeMarket(market) === "match_outcome" || this.normalizeMarket(market) === "match_result") {
        return "home";
      }
      return "yes";
    }
    if (["h", "1", "home"].includes(token)) {
      return "home";
    }
    if (["x", "d", "draw"].includes(token)) {
      return "draw";
    }
    if (["a", "2", "away"].includes(token)) {
      return "away";
    }
    if (["o", "over"].includes(token)) {
      return "over";
    }
    if (["u", "under"].includes(token)) {
      return "under";
    }
    if (["y", "yes"].includes(token)) {
      return "yes";
    }
    if (["n", "no"].includes(token)) {
      return "no";
    }
    const htft = token.replace(/[^hdax12]/g, "").toUpperCase();
    if (["HH", "HD", "HA", "DH", "DD", "DA", "AH", "AD", "AA", "1X", "12", "X1", "X2", "21", "2X"].includes(htft)) {
      return htft.replace(/1/g, "H").replace(/2/g, "A").replace(/X/g, "D").toLowerCase();
    }
    return token;
  }

  private extractProbabilityFromExplanation(
    explanationJson: Prisma.JsonValue,
    normalizedSelection: string,
    fallbackProbability: number
  ) {
    const explanation = this.asRecord(explanationJson);
    const calibrated =
      this.asRecord(explanation?.calibratedProbabilities) ??
      this.asRecord(explanation?.probabilities) ??
      this.asRecord(explanation?.rawProbabilities);
    if (!calibrated) {
      return this.clamp(fallbackProbability, 0.0001, 0.9999);
    }
    const candidate = this.asNumber(calibrated[normalizedSelection]);
    if (candidate === null) {
      return this.clamp(fallbackProbability, 0.0001, 0.9999);
    }
    return this.clamp(candidate, 0.0001, 0.9999);
  }

  private actualLabelForSelection(
    market: string,
    normalizedSelection: string,
    line: number | null,
    match: {
      homeScore: number | null;
      awayScore: number | null;
      halfTimeHomeScore: number | null;
      halfTimeAwayScore: number | null;
    }
  ) {
    const marketToken = this.normalizeMarket(market);
    if (marketToken === "match_outcome" || marketToken === "match_result" || marketToken === "moneyline") {
      if (match.homeScore === null || match.awayScore === null) {
        return null;
      }
      const outcome = match.homeScore > match.awayScore ? "home" : match.homeScore < match.awayScore ? "away" : "draw";
      return outcome === normalizedSelection ? 1 : 0;
    }

    if (marketToken === "both_teams_to_score" || marketToken === "btts") {
      if (match.homeScore === null || match.awayScore === null) {
        return null;
      }
      const yes = match.homeScore > 0 && match.awayScore > 0;
      return normalizedSelection === "yes" ? (yes ? 1 : 0) : yes ? 0 : 1;
    }

    if (marketToken === "total_goals_over_under" || marketToken === "total_goals") {
      if (match.homeScore === null || match.awayScore === null || line === null) {
        return null;
      }
      const total = match.homeScore + match.awayScore;
      const over = total > line;
      return normalizedSelection === "over" ? (over ? 1 : 0) : over ? 0 : 1;
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
      return outcome === normalizedSelection ? 1 : 0;
    }

    if (marketToken === "half_time_full_time" || marketToken === "half_time_fulltime" || marketToken === "htft") {
      if (
        match.homeScore === null ||
        match.awayScore === null ||
        match.halfTimeHomeScore === null ||
        match.halfTimeAwayScore === null
      ) {
        return null;
      }
      const half =
        match.halfTimeHomeScore > match.halfTimeAwayScore
          ? "h"
          : match.halfTimeHomeScore < match.halfTimeAwayScore
            ? "a"
            : "d";
      const full = match.homeScore > match.awayScore ? "h" : match.homeScore < match.awayScore ? "a" : "d";
      return `${half}${full}` === normalizedSelection ? 1 : 0;
    }

    if (marketToken === "correct_score" || marketToken === "correctscore") {
      if (match.homeScore === null || match.awayScore === null) {
        return null;
      }
      return `${match.homeScore}-${match.awayScore}` === normalizedSelection ? 1 : 0;
    }

    if (match.homeScore === null || match.awayScore === null) {
      return null;
    }
    const binaryDefault = match.homeScore >= match.awayScore ? "home" : "away";
    return binaryDefault === normalizedSelection ? 1 : 0;
  }

  private computeBrier(samples: CalibrationSample[]) {
    if (samples.length === 0) {
      return null;
    }
    const total = samples.reduce((sum, item) => sum + (item.predicted - item.actual) ** 2, 0);
    return this.round(total / samples.length);
  }

  private computeLogLoss(samples: CalibrationSample[]) {
    if (samples.length === 0) {
      return null;
    }
    const total = samples.reduce((sum, item) => {
      const p = this.clamp(item.predicted, 1e-6, 1 - 1e-6);
      return sum + -(item.actual * Math.log(p) + (1 - item.actual) * Math.log(1 - p));
    }, 0);
    return this.round(total / samples.length);
  }

  private computeCalibrationBins(samples: CalibrationSample[], bins: number) {
    const bucketCount = Math.max(4, Math.min(20, Math.floor(bins)));
    const buckets = Array.from({ length: bucketCount }, (_, index) => ({
      bucket: index,
      from: index / bucketCount,
      to: (index + 1) / bucketCount,
      count: 0,
      predictedMean: 0,
      observedRate: 0
    }));

    for (const sample of samples) {
      const idx = Math.min(bucketCount - 1, Math.floor(this.clamp(sample.predicted, 0, 0.999999) * bucketCount));
      const bucket = buckets[idx];
      bucket.count += 1;
      bucket.predictedMean += sample.predicted;
      bucket.observedRate += sample.actual;
    }

    let ece = 0;
    for (const bucket of buckets) {
      if (bucket.count === 0) {
        continue;
      }
      bucket.predictedMean = this.round(bucket.predictedMean / bucket.count, 6);
      bucket.observedRate = this.round(bucket.observedRate / bucket.count, 6);
      ece += (bucket.count / Math.max(1, samples.length)) * Math.abs(bucket.predictedMean - bucket.observedRate);
    }

    return {
      buckets,
      ece: this.round(ece)
    };
  }

  private async loadSamples(input: CalibrationCurveInput): Promise<CalibrationSample[]> {
    const normalizedSelection = this.normalizeSelection(input.selection, input.market);
    const lineKey = this.lineKey(input.line);
    const lookbackStart = new Date(Date.now() - (input.lookbackDays ?? 180) * 24 * 60 * 60 * 1000);
    const rows = await this.prisma.publishedPrediction.findMany({
      where: {
        market: input.market,
        ...(input.horizon ? { horizon: input.horizon } : {}),
        ...(lineKey === "na" ? { lineKey: "na" } : { lineKey }),
        ...(input.modelVersionId ? { predictionRun: { modelVersionId: input.modelVersionId } } : {}),
        publishedAt: { gte: lookbackStart },
        match: {
          homeScore: { not: null },
          awayScore: { not: null }
        }
      },
      orderBy: { publishedAt: "asc" },
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
            probability: true,
            explanationJson: true
          }
        }
      },
      take: 5000
    });

    const samples: CalibrationSample[] = [];
    for (const row of rows) {
      const predicted = this.extractProbabilityFromExplanation(
        row.predictionRun.explanationJson,
        normalizedSelection,
        row.predictionRun.probability
      );
      const actual = this.actualLabelForSelection(input.market, normalizedSelection, row.line, row.match);
      if (actual === null) {
        continue;
      }
      samples.push({
        predicted,
        actual
      });
    }
    return samples;
  }

  async calibrationCurve(input: CalibrationCurveInput) {
    const samples = await this.loadSamples(input);
    const brierScore = this.computeBrier(samples);
    const logLoss = this.computeLogLoss(samples);
    const { buckets, ece } = this.computeCalibrationBins(samples, input.bins ?? 10);

    return {
      sampleSize: samples.length,
      brierScore,
      logLoss,
      ece,
      bins: buckets
    };
  }

  async calibratePrediction(input: CalibratePredictionInput): Promise<CalibratedPredictionOutput> {
    const normalizedRaw = this.clamp(input.rawProbability, 0.0001, 0.9999);
    const marketConfig = this.marketConfig(input.market);
    const calibrationBucket = this.bucketForProbability(normalizedRaw, 10);
    const samples = await this.loadSamples({
      market: input.market,
      horizon: input.horizon,
      line: input.line ?? null,
      selection: input.selection ?? null,
      modelVersionId: input.modelVersionId ?? null,
      lookbackDays: input.lookbackDays ?? 180,
      bins: 10
    });

    const sampleSize = samples.length;
    const avgPredicted = sampleSize > 0 ? this.avg(samples.map((item) => item.predicted)) : normalizedRaw;
    const empiricalRate = sampleSize > 0 ? this.avg(samples.map((item) => item.actual)) : normalizedRaw;
    const correction = empiricalRate - avgPredicted;
    const sampleWeight = this.clamp(sampleSize / marketConfig.fullSampleTarget, 0, 1);
    const hasMinimumSample = sampleSize >= marketConfig.minSampleThreshold;
    const correctionWeight = hasMinimumSample ? marketConfig.maxCorrectionWeight * sampleWeight : 0;
    const corrected = normalizedRaw + correction * correctionWeight;
    const conservativeBlend = hasMinimumSample ? 0.8 : 0.35;
    const calibratedProbability = this.clamp(
      normalizedRaw * (1 - conservativeBlend) + corrected * conservativeBlend,
      0.0001,
      0.9999
    );

    const brierScore = this.computeBrier(samples);
    const logLoss = this.computeLogLoss(samples);
    const { ece } = this.computeCalibrationBins(samples, 10);

    const freshnessScore = this.clamp(input.freshnessScore ?? 0.65, 0, 1);
    const providerDisagreement = this.clamp(input.providerDisagreement ?? 0, 0, 1);
    const missingStatsRatio = this.clamp(input.coverage?.missingStatsRatio ?? 0.4, 0, 1);
    const hasOdds = input.coverage?.hasOdds ?? false;
    const hasLineup = input.coverage?.hasLineup ?? false;
    const hasEvent = input.coverage?.hasEvent ?? false;
    const oddsCoverage = this.clamp(input.coverage?.oddsCoverage ?? Number(hasOdds), 0, 1);
    const lineupCoverage = this.clamp(input.coverage?.lineupCoverage ?? Number(hasLineup), 0, 1);
    const eventCoverage = this.clamp(input.coverage?.eventCoverage ?? Number(hasEvent), 0, 1);
    const volatilityScore = this.clamp(input.volatilityScore ?? 0, 0, 1);

    const edgeStrength = Math.abs(calibratedProbability - 0.5) * 2;
    const coveragePenalty =
      (1 - oddsCoverage) * 0.08 + (1 - lineupCoverage) * 0.05 + (1 - eventCoverage) * 0.03 + missingStatsRatio * 0.18;
    const disagreementPenalty = providerDisagreement * 0.24;
    const volatilityPenalty = volatilityScore * 0.08;
    const conservativePenalty = hasMinimumSample ? marketConfig.conservativePenalty : marketConfig.conservativePenalty + 0.04;
    const confidenceScore = this.clamp(
      0.34 +
        edgeStrength * 0.44 +
        freshnessScore * 0.22 -
        coveragePenalty -
        disagreementPenalty -
        volatilityPenalty -
        conservativePenalty,
      0.1,
      0.97
    );

    const riskFlags: Array<{ code: string; severity: "low" | "medium" | "high"; message: string }> = [];
    if (!hasMinimumSample) {
      riskFlags.push({
        code: "LOW_CALIBRATION_SAMPLE",
        severity: "medium",
        message: "Kalibrasyon örneklem sayısı düşük, olasılık düzeltmesi sınırlı uygulandı."
      });
    }
    if (!hasOdds) {
      riskFlags.push({
        code: "NO_ODDS_COVERAGE",
        severity: "low",
        message: "Oran kapsamı sınırlı, confidence skoru temkinli hesaplandı."
      });
    }
    if (!hasLineup) {
      riskFlags.push({
        code: "NO_LINEUP_COVERAGE",
        severity: "low",
        message: "Kadro doğrulaması eksik, analiz belirsizliği arttı."
      });
    }
    if (!hasEvent) {
      riskFlags.push({
        code: "NO_EVENT_COVERAGE",
        severity: "low",
        message: "Mac ici olay kapsami sinirli, confidence skoru temkinli hesaplandi."
      });
    }
    if (missingStatsRatio > 0.45) {
      riskFlags.push({
        code: "HIGH_MISSING_STATS_RATIO",
        severity: "high",
        message: "İstatistik kapsaması düşük, model güveni düşürüldü."
      });
    }
    if (providerDisagreement > 0.12) {
      riskFlags.push({
        code: "PROVIDER_DISAGREEMENT",
        severity: "medium",
        message: "Kaynaklar arası ayrışma yüksek, tahmin oynaklığı arttı."
      });
    }
    if (volatilityScore > 0.18) {
      riskFlags.push({
        code: "MARKET_VOLATILITY",
        severity: "medium",
        message: "Piyasa oynakligi yuksek, confidence skoru dusuruldu."
      });
    }

    const calibrationMethod =
      sampleSize === 0
        ? "raw_passthrough_no_published_samples"
        : hasMinimumSample
          ? marketConfig.profile === "standard"
            ? "published_time_ordered_empirical"
            : "market_conservative_time_ordered_empirical"
          : "sample_limited_shrinkage";

    return {
      calibratedProbability: this.round(calibratedProbability, 6),
      confidenceScore: this.round(confidenceScore, 6),
      calibration: {
        sampleSize,
        avgPredicted: this.round(avgPredicted, 6),
        empiricalRate: this.round(empiricalRate, 6),
        brierScore,
        logLoss,
        ece
      },
      calibrationDiagnostics: {
        calibrationSampleSize: sampleSize,
        calibrationBucket,
        calibrationMethod,
        minSampleThreshold: marketConfig.minSampleThreshold,
        marketProfile: marketConfig.profile,
        correctionWeight: this.round(correctionWeight, 6),
        conservativePenalty: this.round(conservativePenalty, 6)
      },
      riskFlags
    };
  }
}
