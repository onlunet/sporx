import { Prisma } from "@prisma/client";
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/models")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminModelsController {
  constructor(private readonly prisma: PrismaService) {}

  private readonly baselineModelSeeds: Array<{
    modelName: string;
    version: string;
    trainingWindow: string;
    parameters: Prisma.InputJsonValue;
    preferredActive: boolean;
  }> = [
    {
      modelName: "elo_poisson",
      version: "v1",
      trainingWindow: "rolling_18m",
      parameters: { usesElo: true, usesPoisson: true, usesCalibration: true },
      preferredActive: false
    },
    {
      modelName: "elo_poisson_dc",
      version: "v2",
      trainingWindow: "rolling_24m",
      parameters: {
        usesElo: true,
        usesPoisson: true,
        usesDixonColes: true,
        usesDynamicLambda: true,
        usesTimeDecay: true
      },
      preferredActive: true
    },
    {
      modelName: "market_aware_blend",
      version: "v1",
      trainingWindow: "rolling_24m",
      parameters: { usesCoreModel: true, usesMarketLayer: true, optionalOdds: true },
      preferredActive: false
    }
  ];

  private async bootstrapBaselineModelRegistry() {
    for (const seed of this.baselineModelSeeds) {
      await this.prisma.modelVersion.upsert({
        where: {
          modelName_version: {
            modelName: seed.modelName,
            version: seed.version
          }
        },
        update: {},
        create: {
          modelName: seed.modelName,
          version: seed.version,
          trainingWindow: seed.trainingWindow,
          parameters: seed.parameters,
          active: seed.preferredActive
        }
      });
    }
  }

  private async ensureSingleActiveModel() {
    const models = await this.prisma.modelVersion.findMany({
      select: { id: true, modelName: true, version: true, active: true, createdAt: true },
      orderBy: { createdAt: "desc" }
    });

    if (models.length === 0) {
      return null;
    }

    const active = models.find((item) => item.active);
    if (active) {
      return active.id;
    }

    const preferred = models.find((item) => item.modelName === "elo_poisson_dc" && item.version === "v2");
    const chosen = preferred ?? models[0];

    await this.prisma.$transaction([
      this.prisma.modelVersion.updateMany({ data: { active: false } }),
      this.prisma.modelVersion.update({ where: { id: chosen.id }, data: { active: true } })
    ]);

    return chosen.id;
  }

  private async backfillPredictionsWithoutModelVersion(activeModelId: string | null) {
    void activeModelId;
  }

  private async ensureModelRegistry() {
    await this.bootstrapBaselineModelRegistry();
    await this.ensureSingleActiveModel();
  }

  private normalizeConfidence(value: unknown): number {
    const numeric = this.asNumber(value);
    if (numeric === null) {
      return 0.5;
    }
    if (numeric > 1) {
      return this.clamp(numeric / 100);
    }
    return this.clamp(numeric);
  }

  private buildOperationalPerformanceRows(
    rows: Array<{
      id: string;
      modelVersionId: string | null;
      confidence: number;
      riskFlagsJson: Prisma.JsonValue;
      createdAt: Date;
    }>
  ) {
    const bucket = new Map<
      string,
      {
        modelVersionId: string;
        measuredAt: Date;
        count: number;
        confidenceTotal: number;
        riskyCount: number;
      }
    >();

    for (const row of rows) {
      if (!row.modelVersionId) {
        continue;
      }

      const measuredAt = new Date(row.createdAt.toISOString().slice(0, 10));
      const key = `${row.modelVersionId}|${measuredAt.toISOString()}`;
      const current = bucket.get(key) ?? {
        modelVersionId: row.modelVersionId,
        measuredAt,
        count: 0,
        confidenceTotal: 0,
        riskyCount: 0
      };

      const riskFlags = Array.isArray(row.riskFlagsJson) ? row.riskFlagsJson : [];
      current.count += 1;
      current.confidenceTotal += this.normalizeConfidence(row.confidence);
      current.riskyCount += riskFlags.length > 0 ? 1 : 0;
      bucket.set(key, current);
    }

    return [...bucket.values()]
      .map((item) => {
        const avgConfidence = item.confidenceTotal / Math.max(1, item.count);
        const riskRate = item.riskyCount / Math.max(1, item.count);
        const proxyAccuracy = this.clamp(avgConfidence * 0.92 + (1 - riskRate) * 0.08, 0.35, 0.9);
        const proxyBrier = this.clamp((1 - proxyAccuracy) * 0.72, 0.05, 0.55);
        const proxyLogLoss = -Math.log(Math.max(1e-6, proxyAccuracy));

        return {
          id: `proxy-${item.modelVersionId}-${item.measuredAt.toISOString().slice(0, 10)}`,
          modelVersionId: item.modelVersionId,
          measuredAt: item.measuredAt,
          metrics: {
            accuracy: this.round(proxyAccuracy),
            brier: this.round(proxyBrier),
            logLoss: this.round(proxyLogLoss),
            avgConfidence: this.round(avgConfidence),
            riskRate: this.round(riskRate),
            sampleSize: item.count,
            isProxy: true,
            proxyReason: "completed_match_result_missing"
          }
        };
      })
      .sort((left, right) => right.measuredAt.getTime() - left.measuredAt.getTime());
  }

  private async modelVersionsForInventory() {
    await this.ensureModelRegistry();
    return this.prisma.modelVersion.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        modelName: true,
        version: true,
        active: true,
        trainingWindow: true,
        createdAt: true
      }
    });
  }

  private async modelVersionsForComparison() {
    await this.ensureModelRegistry();
    return this.prisma.modelVersion.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      select: { id: true, modelName: true, version: true, active: true, createdAt: true }
    });
  }

  private async ensureDefaultStrategies() {
    const count = await this.prisma.modelStrategy.count();
    if (count > 0) {
      return;
    }

    await this.prisma.modelStrategy.createMany({
      data: [
        {
          name: "core_model_only",
          config: { coreWeight: 1, marketWeight: 0, confidencePenalty: 0.08 },
          isActive: true,
          notes: "Temel model agirlikli varsayilan strateji"
        },
        {
          name: "adaptive_confidence",
          config: { coreWeight: 0.9, marketWeight: 0.1, confidencePenalty: 0.12, dynamicRisk: true },
          isActive: false,
          notes: "Guven skoru ve risk sinyaline gore agirlik ayarlar"
        },
        {
          name: "market_assisted",
          config: { coreWeight: 0.82, marketWeight: 0.18, disagreementPenalty: 0.16 },
          isActive: false,
          notes: "Piyasa sinyallerini yardimci katman olarak kullanir"
        }
      ]
    });
  }

  private async ensureDefaultEnsembleConfigs() {
    const defaults: Array<{ key: string; value: Prisma.InputJsonValue; description: string }> = [
      {
        key: "ensemble.coreModelWeight",
        value: { value: 0.82, min: 0.5, max: 0.95 },
        description: "Temel model olasiliklarinin nihai karardaki agirligi"
      },
      {
        key: "ensemble.marketWeight",
        value: { value: 0.18, min: 0.05, max: 0.4 },
        description: "Piyasa sinyali katkisi (opsiyonel odds katmani)"
      },
      {
        key: "ensemble.disagreementPenaltyWeight",
        value: { value: 0.16, min: 0, max: 0.4 },
        description: "Model-piyasa ayrismasinda guven dusurme katsayisi"
      }
    ];

    for (const entry of defaults) {
      await this.prisma.systemSetting.upsert({
        where: { key: entry.key },
        update: {},
        create: {
          key: entry.key,
          value: entry.value,
          description: entry.description
        }
      });
    }
  }

  private normalizeModelName(value: string | null | undefined) {
    if (!value || value.trim().length === 0) {
      return "prediction_pipeline";
    }
    return value.trim().replace(/[\s_-]+/g, " ");
  }

  private shortModelVersion(value: string | null | undefined) {
    if (!value || value.trim().length === 0) {
      return "unversioned";
    }
    const normalized = value.trim();
    if (normalized.includes("-")) {
      return normalized.split("-")[0];
    }
    return normalized.slice(0, 12);
  }

  private predictionRunFallbackRows(
    countRows: Array<{ modelVersionId: string | null; _count: { _all: number } }>,
    metaRows: Array<{ modelVersionId: string | null; market: string; horizon: string; createdAt: Date }>
  ) {
    if (countRows.length === 0) {
      return [];
    }

    const latestMetaByModelVersionId = new Map<string, { market: string; horizon: string; createdAt: Date }>();
    let latestUnversionedMeta: { market: string; horizon: string; createdAt: Date } | null = null;

    for (const row of metaRows) {
      if (row.modelVersionId) {
        if (!latestMetaByModelVersionId.has(row.modelVersionId)) {
          latestMetaByModelVersionId.set(row.modelVersionId, {
            market: row.market,
            horizon: row.horizon,
            createdAt: row.createdAt
          });
        }
        continue;
      }

      if (!latestUnversionedMeta) {
        latestUnversionedMeta = {
          market: row.market,
          horizon: row.horizon,
          createdAt: row.createdAt
        };
      }
    }

    return countRows
      .map((row) => {
        if (row.modelVersionId) {
          const meta = latestMetaByModelVersionId.get(row.modelVersionId) ?? null;
          const modelName = this.normalizeModelName(meta?.market ?? "prediction_pipeline");
          const version = this.shortModelVersion(row.modelVersionId);
          return {
            modelVersionId: row.modelVersionId,
            modelName,
            version,
            modelLabel: `${modelName}:${version}`,
            predictionCount: row._count._all,
            updatedByProcess: meta ? `prediction_run:${meta.market}:${meta.horizon}` : null,
            dataSource: "prediction_runs",
            createdAt: meta?.createdAt ?? new Date(0)
          };
        }

        const meta = latestUnversionedMeta;
        const modelName = this.normalizeModelName(meta?.market ?? "prediction_pipeline");
        return {
          modelVersionId: null,
          modelName,
          version: "unversioned",
          modelLabel: `${modelName}:unversioned`,
          predictionCount: row._count._all,
          updatedByProcess: meta ? `prediction_run:${meta.market}:${meta.horizon}` : null,
          dataSource: "prediction_runs",
          createdAt: meta?.createdAt ?? new Date(0)
        };
      })
      .sort(
        (left, right) =>
          right.predictionCount - left.predictionCount || right.createdAt.getTime() - left.createdAt.getTime()
      );
  }

  private metricsFromJson(value: Prisma.JsonValue | null): { accuracy?: number; brier?: number; logLoss?: number } {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const raw = value as Record<string, unknown>;
    const read = (key: string) => {
      const candidate = raw[key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return Number(candidate.toFixed(4));
      }
      return undefined;
    };

    return {
      accuracy: read("accuracy"),
      brier: read("brier"),
      logLoss: read("logLoss")
    };
  }

  private isSchemaCompatibilityError(error: unknown) {
    const prismaCode = (error as { code?: string } | null)?.code;
    if (prismaCode === "P2021" || prismaCode === "P2022" || prismaCode === "P2010") {
      return true;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2021" || error.code === "P2022" || error.code === "P2010") {
        return true;
      }
    }

    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "";

    return /relation .* does not exist|table .* does not exist|column .* does not exist|no such table|unknown column|invalid `prisma/i.test(
      message.toLowerCase()
    );
  }

  private predictionRunInventoryFallbackRows(
    predictionRunCounts: Array<{ modelVersionId: string | null; _count: { _all: number } }>,
    predictionRunMetaRows: Array<{ modelVersionId: string | null; market: string; horizon: string; createdAt: Date }>
  ) {
    const fallbackRows = this.predictionRunFallbackRows(predictionRunCounts, predictionRunMetaRows);
    return fallbackRows.map((row, index) => ({
      id: row.modelVersionId ? `fallback-${row.modelVersionId}` : "fallback-unversioned",
      modelVersionId: row.modelVersionId,
      modelName: row.modelName,
      version: row.version,
      modelLabel: row.modelLabel,
      active: index === 0,
      trainingWindow: "-",
      predictionCount: row.predictionCount,
      usageStatus: "Tahminde Kullaniliyor",
      performancePointCount: 0,
      calibrationCount: 0,
      backtestCount: 0,
      comparisonCount: 0,
      accuracy: null,
      brier: null,
      logLoss: null,
      lastMeasuredAt: null,
      source: "prediction_run_fallback",
      createdAt: row.createdAt
    }));
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return null;
      }
    }
    return null;
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

  private avg(values: number[]) {
    if (values.length === 0) {
      return null;
    }
    return values.reduce((sum, item) => sum + item, 0) / values.length;
  }

  private std(values: number[]) {
    if (values.length <= 1) {
      return 0;
    }
    const mean = this.avg(values) ?? 0;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private round(value: number, digits = 4) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private clamp(value: number, min = 0, max = 1) {
    return Math.max(min, Math.min(max, value));
  }

  private normalizeSelectionToken(value: string | null | undefined): "home" | "draw" | "away" | null {
    const normalized = (value ?? "").trim().toLowerCase();
    if (["home", "h", "1"].includes(normalized)) {
      return "home";
    }
    if (["draw", "d", "x"].includes(normalized)) {
      return "draw";
    }
    if (["away", "a", "2"].includes(normalized)) {
      return "away";
    }
    return null;
  }

  private parseOutcomeProbabilitiesFromMap(value: unknown): { home: number; draw: number; away: number } | null {
    const candidate = this.asObject(value);
    if (!candidate) {
      return null;
    }
    const home = this.asNumber(candidate.home);
    const draw = this.asNumber(candidate.draw);
    const away = this.asNumber(candidate.away);
    if (home === null || draw === null || away === null) {
      return null;
    }
    const sum = home + draw + away;
    if (!Number.isFinite(sum) || sum <= 0) {
      return null;
    }
    return {
      home: this.round(home / sum, 6),
      draw: this.round(draw / sum, 6),
      away: this.round(away / sum, 6)
    };
  }

  private parseOutcomeProbabilitiesFromRun(run: {
    market: string;
    probability: number;
    explanationJson: Prisma.JsonValue;
  }): { home: number; draw: number; away: number } | null {
    const normalizedMarket = run.market.trim().toLowerCase();
    if (!["match_outcome", "match_result", "moneyline", "full_time_result"].includes(normalizedMarket)) {
      return null;
    }

    const explanation = this.asObject(run.explanationJson);
    const mapped = [
      this.parseOutcomeProbabilitiesFromMap(explanation?.calibratedProbabilities),
      this.parseOutcomeProbabilitiesFromMap(explanation?.probabilities),
      this.parseOutcomeProbabilitiesFromMap(explanation?.rawProbabilities)
    ].find((item) => Boolean(item));

    if (mapped) {
      return mapped;
    }

    const selected = this.normalizeSelectionToken(typeof explanation?.selectedSide === "string" ? explanation.selectedSide : null);
    const probability = Number.isFinite(run.probability) ? this.clamp(run.probability, 0.000001, 0.999999) : null;
    if (!selected || probability === null) {
      return null;
    }

    const remainder = this.round((1 - probability) / 2, 6);
    if (selected === "home") {
      return { home: this.round(probability, 6), draw: remainder, away: remainder };
    }
    if (selected === "draw") {
      return { home: remainder, draw: this.round(probability, 6), away: remainder };
    }
    return { home: remainder, draw: remainder, away: this.round(probability, 6) };
  }

  private outcomeFromScore(homeScore: number | null, awayScore: number | null): "home" | "draw" | "away" | null {
    if (homeScore === null || awayScore === null) {
      return null;
    }
    if (homeScore > awayScore) {
      return "home";
    }
    if (homeScore < awayScore) {
      return "away";
    }
    return "draw";
  }

  private buildPerformanceRowsFromPublishedRuns(
    rows: Array<{
      predictionRunId: string;
      predictionRun: {
        modelVersionId: string | null;
        market: string;
        probability: number;
        confidence: number;
        riskFlagsJson: Prisma.JsonValue;
        explanationJson: Prisma.JsonValue;
      };
      match: { homeScore: number | null; awayScore: number | null; matchDateTimeUTC: Date };
    }>
  ) {
    const bucket = new Map<
      string,
      {
        modelVersionId: string;
        measuredAt: Date;
        count: number;
        correct: number;
        brier: number;
        logLoss: number;
        confidence: number;
        riskRateCount: number;
      }
    >();

    for (const row of rows) {
      if (!row.predictionRun.modelVersionId) {
        continue;
      }
      const probabilities = this.parseOutcomeProbabilitiesFromRun({
        market: row.predictionRun.market,
        probability: row.predictionRun.probability,
        explanationJson: row.predictionRun.explanationJson
      });
      if (!probabilities) {
        continue;
      }

      const actual = this.outcomeFromScore(row.match.homeScore, row.match.awayScore);
      if (!actual) {
        continue;
      }

      const measuredAt = new Date(row.match.matchDateTimeUTC.toISOString().slice(0, 10));
      const key = `${row.predictionRun.modelVersionId}|${measuredAt.toISOString()}`;
      const current = bucket.get(key) ?? {
        modelVersionId: row.predictionRun.modelVersionId,
        measuredAt,
        count: 0,
        correct: 0,
        brier: 0,
        logLoss: 0,
        confidence: 0,
        riskRateCount: 0
      };

      const predicted =
        probabilities.home >= probabilities.draw && probabilities.home >= probabilities.away
          ? "home"
          : probabilities.draw >= probabilities.home && probabilities.draw >= probabilities.away
            ? "draw"
            : "away";
      const pHome = probabilities.home;
      const pDraw = probabilities.draw;
      const pAway = probabilities.away;
      const oHome = actual === "home" ? 1 : 0;
      const oDraw = actual === "draw" ? 1 : 0;
      const oAway = actual === "away" ? 1 : 0;
      const pActual = actual === "home" ? pHome : actual === "draw" ? pDraw : pAway;
      const brier = ((pHome - oHome) ** 2 + (pDraw - oDraw) ** 2 + (pAway - oAway) ** 2) / 3;
      const logLoss = -Math.log(Math.max(1e-6, pActual));
      const riskFlags = Array.isArray(row.predictionRun.riskFlagsJson) ? row.predictionRun.riskFlagsJson : [];

      current.count += 1;
      current.correct += predicted === actual ? 1 : 0;
      current.brier += brier;
      current.logLoss += logLoss;
      current.confidence += Number.isFinite(row.predictionRun.confidence) ? row.predictionRun.confidence : 0;
      current.riskRateCount += riskFlags.length > 0 ? 1 : 0;

      bucket.set(key, current);
    }

    return [...bucket.values()]
      .map((item) => ({
        id: `synthetic-${item.modelVersionId}-${item.measuredAt.toISOString().slice(0, 10)}`,
        modelVersionId: item.modelVersionId,
        measuredAt: item.measuredAt,
        metrics: {
          accuracy: this.round(item.correct / item.count),
          brier: this.round(item.brier / item.count),
          logLoss: this.round(item.logLoss / item.count),
          avgConfidence: this.round(item.confidence / item.count),
          riskRate: this.round(item.riskRateCount / item.count),
          sampleSize: item.count
        }
      }))
      .sort((left, right) => right.measuredAt.getTime() - left.measuredAt.getTime());
  }

  private buildDriftRowsFromPerformanceRows(
    rows: Array<{ id: string; modelVersionId: string; measuredAt: Date; metrics: Record<string, unknown> }>
  ) {
    const byModel = new Map<string, Array<{ id: string; modelVersionId: string; measuredAt: Date; metrics: Record<string, unknown> }>>();
    for (const row of rows) {
      const list = byModel.get(row.modelVersionId) ?? [];
      list.push(row);
      byModel.set(row.modelVersionId, list);
    }

    const driftRows: Array<{ id: string; modelVersionId: string; measuredAt: Date; metrics: Record<string, unknown> }> = [];
    for (const [modelVersionId, series] of byModel.entries()) {
      const sorted = series.sort((left, right) => left.measuredAt.getTime() - right.measuredAt.getTime());
      for (let index = 0; index < sorted.length; index += 1) {
        const row = sorted[index];
        const windowStart = Math.max(0, index - 6);
        const baseline = sorted.slice(windowStart, index);
        const baselineAccuracy = this.avg(
          baseline.map((item) => this.asNumber(item.metrics.accuracy)).filter((value): value is number => value !== null)
        );
        const baselineBrier = this.avg(
          baseline.map((item) => this.asNumber(item.metrics.brier)).filter((value): value is number => value !== null)
        );
        const baselineLogLoss = this.avg(
          baseline.map((item) => this.asNumber(item.metrics.logLoss)).filter((value): value is number => value !== null)
        );

        const currentAccuracy = this.asNumber(row.metrics.accuracy) ?? 0;
        const currentBrier = this.asNumber(row.metrics.brier) ?? 0;
        const currentLogLoss = this.asNumber(row.metrics.logLoss) ?? 0;
        const accuracyDelta = baselineAccuracy === null ? 0 : currentAccuracy - baselineAccuracy;
        const brierDelta = baselineBrier === null ? 0 : currentBrier - baselineBrier;
        const logLossDelta = baselineLogLoss === null ? 0 : currentLogLoss - baselineLogLoss;
        const driftScore = this.round(
          (Math.abs(accuracyDelta) + Math.abs(brierDelta) + Math.abs(logLossDelta)) / 3
        );

        driftRows.push({
          id: `drift-${row.id}`,
          modelVersionId,
          measuredAt: row.measuredAt,
          metrics: {
            ...row.metrics,
            driftScore,
            accuracyDelta: this.round(accuracyDelta),
            brierDelta: this.round(brierDelta),
            logLossDelta: this.round(logLossDelta)
          }
        });
      }
    }

    return driftRows.sort((left, right) => right.measuredAt.getTime() - left.measuredAt.getTime());
  }

  private parseExpectedTotalGoalsFromExplanation(explanationJson: Prisma.JsonValue): number | null {
    const explanation = this.asObject(explanationJson);
    const expectedScore = this.asObject(explanation?.expectedScore);
    const home = this.asNumber(expectedScore?.home);
    const away = this.asNumber(expectedScore?.away);
    if (home !== null && away !== null) {
      return home + away;
    }

    const expectedGoals = this.asObject(explanation?.expectedGoals);
    const goalsHome = this.asNumber(expectedGoals?.home ?? expectedGoals?.homeGoals);
    const goalsAway = this.asNumber(expectedGoals?.away ?? expectedGoals?.awayGoals);
    if (goalsHome !== null && goalsAway !== null) {
      return goalsHome + goalsAway;
    }

    return null;
  }

  private buildFeatureImportanceRowsFromPredictionRuns(
    modelVersions: Array<{ id: string; modelName: string; version: string }>,
    predictionRunRows: Array<{
      modelVersionId: string | null;
      market: string;
      probability: number;
      confidence: number;
      riskFlagsJson: Prisma.JsonValue;
      explanationJson: Prisma.JsonValue;
      createdAt: Date;
    }>
  ) {
    const rowsByModel = new Map<string, typeof predictionRunRows>();
    for (const row of predictionRunRows) {
      if (!row.modelVersionId) {
        continue;
      }
      const list = rowsByModel.get(row.modelVersionId) ?? [];
      list.push(row);
      rowsByModel.set(row.modelVersionId, list);
    }

    return modelVersions
      .map((model, index) => {
        const rows = rowsByModel.get(model.id) ?? [];
        if (rows.length === 0) {
          return {
            id: `synthetic-fi-empty-${model.id}-${index}`,
            modelVersionId: model.id,
            measuredAt: new Date(),
            values: {
              eloSignal: 0,
              goalDynamics: 0,
              confidenceStability: 0,
              riskImpact: 0,
              sampleSize: 0,
              note: "yeterli_tahmin_verisi_yok"
            }
          };
        }

        const totalGoals = rows
          .map((row) => this.parseExpectedTotalGoalsFromExplanation(row.explanationJson))
          .filter((value): value is number => value !== null);

        const outcomeGap = rows
          .map((row) => {
            const probabilities = this.parseOutcomeProbabilitiesFromRun({
              market: row.market,
              probability: row.probability,
              explanationJson: row.explanationJson
            });
            if (!probabilities) {
              return null;
            }
            return Math.abs(probabilities.home - probabilities.away);
          })
          .filter((value): value is number => value !== null);

        const confidenceSeries = rows
          .map((row) => (Number.isFinite(row.confidence) ? row.confidence : null))
          .filter((value): value is number => value !== null);
        const riskRate =
          rows.filter((row) => (Array.isArray(row.riskFlagsJson) ? row.riskFlagsJson.length > 0 : false)).length / rows.length;
        const avgGoals = this.avg(totalGoals) ?? 2.2;
        const avgGap = this.avg(outcomeGap) ?? 0.2;
        const confidenceStability = this.clamp(1 - this.std(confidenceSeries) / 0.25);
        const goalDynamics = this.clamp(avgGoals / 3.8);
        const eloSignal = this.clamp(avgGap / 0.65);
        const riskImpact = this.clamp(riskRate);

        return {
          id: `synthetic-fi-${model.id}-${index}`,
          modelVersionId: model.id,
          measuredAt: rows[0]?.createdAt ?? new Date(),
          values: {
            eloSignal: this.round(eloSignal),
            goalDynamics: this.round(goalDynamics),
            confidenceStability: this.round(confidenceStability),
            riskImpact: this.round(riskImpact),
            sampleSize: rows.length
          }
        };
      })
      .sort((left, right) => right.measuredAt.getTime() - left.measuredAt.getTime());
  }

  private comparedWithFromJson(
    value: Prisma.JsonValue | null,
    modelById: Map<string, { id: string; modelName: string; version: string }>
  ) {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
          return null;
        }

        const raw = item as Record<string, unknown>;
        const modelVersionId = typeof raw.modelVersionId === "string" ? raw.modelVersionId : undefined;
        const linked = modelVersionId ? modelById.get(modelVersionId) : undefined;
        const modelName =
          typeof raw.modelName === "string"
            ? raw.modelName
            : linked?.modelName ?? (typeof raw.name === "string" ? raw.name : "unknown");
        const version =
          typeof raw.version === "string"
            ? raw.version
            : linked?.version ?? (typeof raw.tag === "string" ? raw.tag : "unknown");

        return {
          modelVersionId: modelVersionId ?? null,
          modelName,
          version,
          modelLabel: `${modelName}:${version}`
        };
      })
      .filter((item): item is { modelVersionId: string | null; modelName: string; version: string; modelLabel: string } => Boolean(item));
  }

  @Get()
  async modelsInventory() {
    try {
      const modelVersions = await this.modelVersionsForInventory();
      const [performanceRows, calibrationCounts, backtestCounts, snapshotCounts, predictionRunCounts, predictionRunMetaRows] =
        await Promise.all([
        this.prisma.modelPerformanceTimeseries.findMany({
          orderBy: { measuredAt: "desc" },
          select: { modelVersionId: true, measuredAt: true, metrics: true }
        }),
        this.prisma.predictionCalibration.groupBy({
          by: ["modelVersionId"],
          _count: { _all: true }
        }),
        this.prisma.backtestResult.groupBy({
          by: ["modelVersionId"],
          _count: { _all: true }
        }),
        this.prisma.modelComparisonSnapshot.groupBy({
          by: ["modelVersionId"],
          _count: { _all: true }
        }),
        this.prisma.predictionRun.groupBy({
          by: ["modelVersionId"],
          _count: { _all: true }
        }),
        this.prisma.predictionRun.findMany({
          select: { modelVersionId: true, market: true, horizon: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20000
        })
      ]);

      if (modelVersions.length === 0) {
        return this.predictionRunInventoryFallbackRows(predictionRunCounts, predictionRunMetaRows);
      }

      const latestMetricsByModelId = new Map<
        string,
        {
          measuredAt: Date;
          accuracy?: number;
          brier?: number;
          logLoss?: number;
        }
      >();
      const performancePointCountByModelId = new Map<string, number>();

      for (const row of performanceRows) {
        performancePointCountByModelId.set(
          row.modelVersionId,
          (performancePointCountByModelId.get(row.modelVersionId) ?? 0) + 1
        );
        if (!latestMetricsByModelId.has(row.modelVersionId)) {
          latestMetricsByModelId.set(row.modelVersionId, {
            measuredAt: row.measuredAt,
            ...this.metricsFromJson(row.metrics)
          });
        }
      }

      const toCountMap = <T extends { modelVersionId: string | null; _count: { _all: number } }>(rows: T[]) => {
        const map = new Map<string, number>();
        for (const row of rows) {
          if (!row.modelVersionId) {
            continue;
          }
          map.set(row.modelVersionId, row._count._all);
        }
        return map;
      };

      const calibrationCountByModelId = toCountMap(calibrationCounts);
      const backtestCountByModelId = toCountMap(backtestCounts);
      const comparisonCountByModelId = toCountMap(snapshotCounts);
      const predictionCountByModelId = toCountMap(predictionRunCounts);

      const rows = modelVersions.map((model) => {
        const latest = latestMetricsByModelId.get(model.id);
        const predictionCount = predictionCountByModelId.get(model.id) ?? 0;

        return {
          id: model.id,
          modelVersionId: model.id,
          modelName: model.modelName,
          version: model.version,
          modelLabel: `${model.modelName}:${model.version}`,
          active: model.active,
          trainingWindow: model.trainingWindow ?? "-",
          predictionCount,
          usageStatus: predictionCount > 0 ? "Tahminde Kullanılıyor" : "Kayıtlı (kullanılmadı)",
          performancePointCount: performancePointCountByModelId.get(model.id) ?? 0,
          calibrationCount: calibrationCountByModelId.get(model.id) ?? 0,
          backtestCount: backtestCountByModelId.get(model.id) ?? 0,
          comparisonCount: comparisonCountByModelId.get(model.id) ?? 0,
          accuracy: latest?.accuracy ?? null,
          brier: latest?.brier ?? null,
          logLoss: latest?.logLoss ?? null,
          lastMeasuredAt: latest?.measuredAt ?? null,
          source: "model_registry",
          createdAt: model.createdAt
        };
      });

      const knownModelIds = new Set(modelVersions.map((model) => model.id));
      const fallbackRows = this.predictionRunFallbackRows(predictionRunCounts, predictionRunMetaRows);
      const orphanRows = fallbackRows
        .filter((row) => row.modelVersionId && !knownModelIds.has(row.modelVersionId))
        .map((row) => ({
          id: `orphan-${row.modelVersionId}`,
          modelVersionId: row.modelVersionId,
          modelName: row.modelName,
          version: row.version,
          modelLabel: row.modelLabel,
          active: false,
          trainingWindow: "-",
          predictionCount: row.predictionCount,
          usageStatus: "Tahminde Kullaniliyor (Kayit eksik)",
          performancePointCount: 0,
          calibrationCount: 0,
          backtestCount: 0,
          comparisonCount: 0,
          accuracy: null,
          brier: null,
          logLoss: null,
          lastMeasuredAt: null,
          source: "prediction_run_orphan",
          createdAt: row.createdAt
        }));

      return [...rows, ...orphanRows].sort(
        (left, right) =>
          Number(right.active) - Number(left.active) ||
          right.predictionCount - left.predictionCount ||
          new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
      );
    } catch (error) {
      if (!this.isSchemaCompatibilityError(error)) {
        throw error;
      }

      const [predictionRunCounts, predictionRunMetaRows] = await Promise.all([
        this.prisma.predictionRun.groupBy({
          by: ["modelVersionId"],
          _count: { _all: true }
        }),
        this.prisma.predictionRun.findMany({
          select: { modelVersionId: true, market: true, horizon: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20000
        })
      ]);

      return this.predictionRunInventoryFallbackRows(predictionRunCounts, predictionRunMetaRows);
    }
  }

  @Get("comparison")
  async comparison() {
    const modelVersions = await this.modelVersionsForComparison();
    const [snapshots, performanceRows] = await Promise.all([
      this.prisma.modelComparisonSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.modelPerformanceTimeseries.findMany({
        orderBy: { measuredAt: "desc" },
        take: 500,
        select: { modelVersionId: true, measuredAt: true, metrics: true }
      })
    ]);

    if (modelVersions.length === 0) {
      const [predictionRunCounts, predictionRunMetaRows] = await Promise.all([
        this.prisma.predictionRun.groupBy({
          by: ["modelVersionId"],
          _count: { _all: true }
        }),
        this.prisma.predictionRun.findMany({
          select: { modelVersionId: true, market: true, horizon: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20000
        })
      ]);

      const fallbackRows = this.predictionRunFallbackRows(predictionRunCounts, predictionRunMetaRows);
      if (fallbackRows.length === 0) {
        return [];
      }

      const winnerModel = fallbackRows[0].modelLabel;
      return fallbackRows.map((row, index) => ({
        id: row.modelVersionId ? `fallback-${row.modelVersionId}` : "fallback-unversioned",
        modelVersionId: row.modelVersionId,
        modelName: row.modelName,
        version: row.version,
        modelLabel: row.modelLabel,
        active: index === 0,
        winnerModel,
        comparedWith: fallbackRows
          .filter((candidate) => candidate.modelLabel !== row.modelLabel)
          .map((candidate) => ({
            modelVersionId: candidate.modelVersionId,
            modelName: candidate.modelName,
            version: candidate.version,
            modelLabel: candidate.modelLabel
          })),
        details: {
          source: "prediction_run_fallback",
          predictionCount: row.predictionCount,
          updatedByProcess: row.updatedByProcess,
          dataSource: row.dataSource
        },
        source: "prediction_run_fallback",
        createdAt: row.createdAt
      }));
    }

    const modelById = new Map(modelVersions.map((item) => [item.id, item]));
    const latestMetricsByModelId = new Map<
      string,
      { measuredAt: Date; accuracy?: number; brier?: number; logLoss?: number }
    >();

    for (const row of performanceRows) {
      if (latestMetricsByModelId.has(row.modelVersionId)) {
        continue;
      }
      latestMetricsByModelId.set(row.modelVersionId, {
        measuredAt: row.measuredAt,
        ...this.metricsFromJson(row.metrics)
      });
    }

    const modelRanking = modelVersions
      .map((item) => {
        const latest = latestMetricsByModelId.get(item.id);
        return {
          id: item.id,
          modelLabel: `${item.modelName}:${item.version}`,
          accuracy: latest?.accuracy ?? -1,
          active: item.active
        };
      })
      .sort((left, right) => right.accuracy - left.accuracy || Number(right.active) - Number(left.active));

    const bestModelLabel =
      modelRanking.find((item) => item.accuracy >= 0)?.modelLabel ?? `${modelVersions[0].modelName}:${modelVersions[0].version}`;

    const snapshotRows = snapshots.map((snapshot) => {
      const model = modelById.get(snapshot.modelVersionId);
      const latest = latestMetricsByModelId.get(snapshot.modelVersionId);
      const sourceModelName = model?.modelName ?? "unknown";
      const sourceVersion = model?.version ?? "unknown";
      const modelLabel = `${sourceModelName}:${sourceVersion}`;
      const comparedWith = this.comparedWithFromJson(snapshot.comparedWith, modelById);

      return {
        id: snapshot.id,
        modelVersionId: snapshot.modelVersionId,
        modelName: sourceModelName,
        version: sourceVersion,
        modelLabel,
        active: model?.active ?? false,
        winnerModel: snapshot.winnerModel ?? bestModelLabel,
        comparedWith,
        details: {
          source: "snapshot",
          latestMetrics: latest
            ? {
                measuredAt: latest.measuredAt,
                accuracy: latest.accuracy ?? null,
                brier: latest.brier ?? null,
                logLoss: latest.logLoss ?? null
              }
            : null,
          ...(snapshot.details && typeof snapshot.details === "object" && !Array.isArray(snapshot.details)
            ? (snapshot.details as Record<string, unknown>)
            : {})
        },
        source: "snapshot",
        createdAt: snapshot.createdAt
      };
    });

    const snapshotModelIds = new Set(snapshotRows.map((item) => item.modelVersionId));
    const derivedRows = modelVersions
      .filter((model) => !snapshotModelIds.has(model.id))
      .map((model) => {
        const latest = latestMetricsByModelId.get(model.id);
        const comparedWith = modelVersions
          .filter((candidate) => candidate.id !== model.id)
          .map((candidate) => ({
            modelVersionId: candidate.id,
            modelName: candidate.modelName,
            version: candidate.version,
            modelLabel: `${candidate.modelName}:${candidate.version}`
          }));

        return {
          id: `derived-${model.id}`,
          modelVersionId: model.id,
          modelName: model.modelName,
          version: model.version,
          modelLabel: `${model.modelName}:${model.version}`,
          active: model.active,
          winnerModel: bestModelLabel,
          comparedWith,
          details: {
            source: "derived",
            reason: "snapshot_missing",
            latestMetrics: latest
              ? {
                  measuredAt: latest.measuredAt,
                  accuracy: latest.accuracy ?? null,
                  brier: latest.brier ?? null,
                  logLoss: latest.logLoss ?? null
                }
              : null
          },
          source: "derived",
          createdAt: latest?.measuredAt ?? model.createdAt
        };
      });

    return [...snapshotRows, ...derivedRows].sort(
      (left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  @Get("feature-importance")
  async featureImportance() {
    await this.ensureModelRegistry();
    const rows = await this.prisma.featureImportanceSnapshot.findMany({ orderBy: { measuredAt: "desc" }, take: 30 });
    if (rows.length > 0) {
      return rows;
    }

    const [modelVersions, predictionRunRows] = await Promise.all([
      this.prisma.modelVersion.findMany({
        select: { id: true, modelName: true, version: true },
        orderBy: [{ active: "desc" }, { createdAt: "desc" }]
      }),
      this.prisma.predictionRun.findMany({
        where: { modelVersionId: { not: null } },
        select: {
          modelVersionId: true,
          market: true,
          probability: true,
          confidence: true,
          riskFlagsJson: true,
          explanationJson: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" },
        take: 12000
      })
    ]);

    const syntheticRows = this.buildFeatureImportanceRowsFromPredictionRuns(modelVersions, predictionRunRows);
    if (syntheticRows.length > 0) {
      return syntheticRows;
    }

    return modelVersions.map((model, index) => ({
      id: `synthetic-fi-empty-${model.id}-${index}`,
      modelVersionId: model.id,
      measuredAt: new Date(),
      values: {
        eloSignal: 0,
        goalDynamics: 0,
        confidenceStability: 0,
        riskImpact: 0,
        sampleSize: 0,
        note: "yeterli_tahmin_verisi_yok"
      }
    }));
  }

  @Get("performance-timeseries")
  async performance() {
    await this.ensureModelRegistry();
    const rows = await this.prisma.modelPerformanceTimeseries.findMany({ orderBy: { measuredAt: "desc" }, take: 200 });
    if (rows.length > 0) {
      return rows;
    }

    const syntheticBaseRows = await this.prisma.publishedPrediction.findMany({
      where: {
        predictionRun: {
          modelVersionId: { not: null }
        },
        match: {
          homeScore: { not: null },
          awayScore: { not: null }
        }
      },
      select: {
        predictionRunId: true,
        predictionRun: {
          select: {
            modelVersionId: true,
            market: true,
            probability: true,
            confidence: true,
            riskFlagsJson: true,
            explanationJson: true
          }
        },
        match: {
          select: {
            homeScore: true,
            awayScore: true,
            matchDateTimeUTC: true
          }
        }
      },
      orderBy: { match: { matchDateTimeUTC: "desc" } },
      take: 30000
    });

    const syntheticRows = this.buildPerformanceRowsFromPublishedRuns(syntheticBaseRows).slice(0, 200);
    if (syntheticRows.length > 0) {
      return syntheticRows;
    }

    const proxyBaseRows = await this.prisma.predictionRun.findMany({
      where: { modelVersionId: { not: null } },
      select: {
        id: true,
        modelVersionId: true,
        confidence: true,
        riskFlagsJson: true,
        createdAt: true
      },
      orderBy: { createdAt: "desc" },
      take: 30000
    });

    return this.buildOperationalPerformanceRows(proxyBaseRows).slice(0, 200);
  }

  @Get("drift-summary")
  async driftSummary() {
    await this.ensureModelRegistry();
    const rows = await this.prisma.modelPerformanceTimeseries.findMany({ orderBy: { measuredAt: "desc" }, take: 20 });
    if (rows.length > 0) {
      return rows;
    }

    const syntheticBaseRows = await this.prisma.publishedPrediction.findMany({
      where: {
        predictionRun: {
          modelVersionId: { not: null }
        },
        match: {
          homeScore: { not: null },
          awayScore: { not: null }
        }
      },
      select: {
        predictionRunId: true,
        predictionRun: {
          select: {
            modelVersionId: true,
            market: true,
            probability: true,
            confidence: true,
            riskFlagsJson: true,
            explanationJson: true
          }
        },
        match: {
          select: {
            homeScore: true,
            awayScore: true,
            matchDateTimeUTC: true
          }
        }
      },
      orderBy: { match: { matchDateTimeUTC: "desc" } },
      take: 30000
    });

    let performanceRows = this.buildPerformanceRowsFromPublishedRuns(syntheticBaseRows).map((row) => ({
      id: row.id,
      modelVersionId: row.modelVersionId,
      measuredAt: row.measuredAt,
      metrics: this.asObject(row.metrics) ?? {}
    }));

    if (performanceRows.length === 0) {
      const proxyBaseRows = await this.prisma.predictionRun.findMany({
        where: { modelVersionId: { not: null } },
        select: {
          id: true,
          modelVersionId: true,
          confidence: true,
          riskFlagsJson: true,
          createdAt: true
        },
        orderBy: { createdAt: "desc" },
        take: 30000
      });

      performanceRows = this.buildOperationalPerformanceRows(proxyBaseRows).map((row) => ({
        id: row.id,
        modelVersionId: row.modelVersionId,
        measuredAt: row.measuredAt,
        metrics: this.asObject(row.metrics) ?? {}
      }));
    }

    return this.buildDriftRowsFromPerformanceRows(performanceRows).slice(0, 20);
  }

  @Get("market-performance")
  async marketPerformance() {
    const marketAnalysisDelegate = (this.prisma as unknown as Record<string, unknown>)["marketAnalysisSnapshot"] as
      | { findMany: (args: { orderBy: { createdAt: "desc" }; take: number }) => Promise<Array<Record<string, unknown>>> }
      | undefined;

    if (!marketAnalysisDelegate?.findMany) {
      return [];
    }

    const rows = await marketAnalysisDelegate.findMany({
      orderBy: { createdAt: "desc" },
      take: 5000
    });

    const grouped = new Map<
      string,
      { predictionType: string; sampleSize: number; gapTotal: number; contradictionTotal: number; consensusTotal: number }
    >();

    for (const row of rows) {
      const predictionType = typeof row.predictionType === "string" ? row.predictionType : "unknown";
      const probabilityGap = typeof row.probabilityGap === "number" ? row.probabilityGap : 0;
      const contradictionScore = typeof row.contradictionScore === "number" ? row.contradictionScore : 0;
      const consensusScore = typeof row.consensusScore === "number" ? row.consensusScore : 0;

      const group = grouped.get(predictionType) ?? {
        predictionType,
        sampleSize: 0,
        gapTotal: 0,
        contradictionTotal: 0,
        consensusTotal: 0
      };
      group.sampleSize += 1;
      group.gapTotal += Math.abs(probabilityGap);
      group.contradictionTotal += Math.max(0, contradictionScore);
      group.consensusTotal += Math.max(0, consensusScore);
      grouped.set(predictionType, group);
    }

    return [...grouped.values()].map((group) => ({
      predictionType: group.predictionType,
      sampleSize: group.sampleSize,
      avgAbsProbabilityGap: Number((group.gapTotal / group.sampleSize).toFixed(4)),
      avgContradictionScore: Number((group.contradictionTotal / group.sampleSize).toFixed(4)),
      avgConsensusScore: Number((group.consensusTotal / group.sampleSize).toFixed(4))
    }));
  }

  @Get("strategies")
  async strategies() {
    await this.ensureDefaultStrategies();
    return this.prisma.modelStrategy.findMany({ orderBy: { updatedAt: "desc" } });
  }

  @Post("strategies/auto-select")
  async autoSelect() {
    await this.ensureDefaultStrategies();
    const latest = await this.prisma.modelStrategy.findFirst({ orderBy: { updatedAt: "desc" } });
    if (!latest) {
      return { selectedStrategyId: null };
    }

    await this.prisma.modelStrategy.updateMany({ data: { isActive: false } });
    const activated = await this.prisma.modelStrategy.update({ where: { id: latest.id }, data: { isActive: true } });
    return { selectedStrategyId: activated.id };
  }

  @Patch("strategies/:id")
  patchStrategy(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.prisma.modelStrategy.update({ where: { id }, data: body });
  }

  @Get("ensemble-configs")
  async ensembleConfigs() {
    await this.ensureDefaultEnsembleConfigs();
    return this.prisma.systemSetting.findMany({ where: { key: { contains: "ensemble" } } });
  }

  @Patch("ensemble-configs/:id")
  patchEnsemble(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.prisma.systemSetting.update({ where: { id }, data: { value: body as Prisma.InputJsonValue } });
  }
}

