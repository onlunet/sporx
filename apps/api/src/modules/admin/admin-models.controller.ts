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
    const [modelVersions, performanceRows, calibrationCounts, backtestCounts, snapshotCounts, predictionCounts] = await Promise.all([
      this.prisma.modelVersion.findMany({
        orderBy: [{ active: "desc" }, { createdAt: "desc" }],
        select: {
          id: true,
          modelName: true,
          version: true,
          active: true,
          trainingWindow: true,
          createdAt: true
        }
      }),
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
      this.prisma.prediction.groupBy({
        by: ["modelVersionId"],
        _count: { _all: true }
      })
    ]);

    if (modelVersions.length === 0) {
      return [];
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
    const predictionCountByModelId = toCountMap(predictionCounts);

    return modelVersions.map((model) => {
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
  }

  @Get("comparison")
  async comparison() {
    const [modelVersions, snapshots, performanceRows] = await Promise.all([
      this.prisma.modelVersion.findMany({
        orderBy: [{ active: "desc" }, { createdAt: "desc" }],
        select: { id: true, modelName: true, version: true, active: true, createdAt: true }
      }),
      this.prisma.modelComparisonSnapshot.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
      this.prisma.modelPerformanceTimeseries.findMany({
        orderBy: { measuredAt: "desc" },
        take: 500,
        select: { modelVersionId: true, measuredAt: true, metrics: true }
      })
    ]);

    if (modelVersions.length === 0) {
      return [];
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
  featureImportance() {
    return this.prisma.featureImportanceSnapshot.findMany({ orderBy: { measuredAt: "desc" }, take: 30 });
  }

  @Get("performance-timeseries")
  performance() {
    return this.prisma.modelPerformanceTimeseries.findMany({ orderBy: { measuredAt: "desc" }, take: 200 });
  }

  @Get("drift-summary")
  driftSummary() {
    return this.prisma.modelPerformanceTimeseries.findMany({ orderBy: { measuredAt: "desc" }, take: 20 });
  }

  @Get("strategies")
  strategies() {
    return this.prisma.modelStrategy.findMany({ orderBy: { updatedAt: "desc" } });
  }

  @Post("strategies/auto-select")
  async autoSelect() {
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
  ensembleConfigs() {
    return this.prisma.systemSetting.findMany({ where: { key: { contains: "ensemble" } } });
  }

  @Patch("ensemble-configs/:id")
  patchEnsemble(@Param("id") id: string, @Body() body: Record<string, unknown>) {
    return this.prisma.systemSetting.update({ where: { id }, data: { value: body as Prisma.InputJsonValue } });
  }
}

