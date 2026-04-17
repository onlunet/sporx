import { Prisma } from "@prisma/client";
import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { FeatureSnapshotService } from "../predictions/feature-snapshot.service";
import { TrainingExampleBuilderService } from "../predictions/training-example-builder.service";

@Controller("admin/features")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminFeaturesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly featureSnapshotService: FeatureSnapshotService,
    private readonly trainingExampleBuilder: TrainingExampleBuilderService
  ) {}

  @Get("lab")
  lab() {
    return this.prisma.featureLabSet.findMany({ include: { experiments: true }, orderBy: { createdAt: "desc" } });
  }

  @Post("lab/experiment")
  experiment(@Body() body: { featureLabSetId: string; name: string; hypothesis: string; config: Record<string, unknown> }) {
    return this.prisma.featureLabExperiment.create({
      data: {
        featureLabSetId: body.featureLabSetId,
        name: body.name,
        hypothesis: body.hypothesis,
        config: body.config as Prisma.InputJsonValue,
        status: "queued"
      }
    });
  }

  @Get("lab/results")
  results() {
    return this.prisma.featureLabExperiment.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
  }

  @Get("freshness")
  async freshness(@Query("take") take?: string) {
    const parsedTake = Number(take);
    const limit = Number.isFinite(parsedTake) ? Math.max(100, Math.min(10000, Math.floor(parsedTake))) : 2500;
    const summary = await this.featureSnapshotService.coverageSummary(limit);
    return {
      updatedAt: new Date().toISOString(),
      ...summary
    };
  }

  @Get("horizon-coverage")
  async horizonCoverage(@Query("take") take?: string) {
    const parsedTake = Number(take);
    const limit = Number.isFinite(parsedTake) ? Math.max(100, Math.min(10000, Math.floor(parsedTake))) : 2500;
    const summary = await this.featureSnapshotService.coverageSummary(limit);
    return {
      updatedAt: new Date().toISOString(),
      horizonCoverage: summary.horizonCoverage,
      coverage: summary.coverage
    };
  }

  @Get("training/examples")
  async trainingExamples(
    @Query("horizons") horizons?: string,
    @Query("cutoffFrom") cutoffFrom?: string,
    @Query("cutoffTo") cutoffTo?: string,
    @Query("includeRows") includeRows?: string
  ) {
    const horizonList =
      typeof horizons === "string" && horizons.trim().length > 0
        ? horizons
            .split(",")
            .map((item) => item.trim())
            .filter((item) => item.length > 0)
        : [];

    const from = cutoffFrom ? new Date(cutoffFrom) : undefined;
    const to = cutoffTo ? new Date(cutoffTo) : undefined;
    const include = includeRows === "true" || includeRows === "1";

    const dataset = await this.trainingExampleBuilder.build({
      horizons: horizonList.length > 0 ? horizonList : undefined,
      cutoffAtGte: from && Number.isFinite(from.getTime()) ? from : undefined,
      cutoffAtLte: to && Number.isFinite(to.getTime()) ? to : undefined
    });

    return {
      ...dataset.meta,
      rows: include ? dataset.rows : []
    };
  }

  @Get("model-candidates-vs-published")
  async candidateVsPublished() {
    const [candidateRows, publishedRows] = await Promise.all([
      this.prisma.predictionRun.groupBy({
        by: ["modelVersionId"],
        _count: { _all: true }
      }),
      this.prisma.publishedPrediction.findMany({
        select: {
          predictionRun: {
            select: {
              modelVersionId: true
            }
          }
        }
      })
    ]);

    const candidateByModel = new Map<string, number>();
    for (const row of candidateRows) {
      const modelVersionId = row.modelVersionId ?? "unversioned";
      candidateByModel.set(modelVersionId, row._count._all);
    }

    const publishedByModel = new Map<string, number>();
    for (const row of publishedRows) {
      const modelVersionId = row.predictionRun.modelVersionId ?? "unversioned";
      publishedByModel.set(modelVersionId, (publishedByModel.get(modelVersionId) ?? 0) + 1);
    }

    const allIds = new Set<string>([...candidateByModel.keys(), ...publishedByModel.keys()]);
    const rows = [...allIds].map((modelVersionId) => {
      const candidateCount = candidateByModel.get(modelVersionId) ?? 0;
      const publishedCount = publishedByModel.get(modelVersionId) ?? 0;
      return {
        modelVersionId,
        candidateCount,
        publishedCount,
        publishRate: candidateCount === 0 ? 0 : Number((publishedCount / candidateCount).toFixed(4))
      };
    });

    return rows.sort((left, right) => right.publishedCount - left.publishedCount);
  }
}
