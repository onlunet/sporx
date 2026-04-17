import { Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { CalibrationService } from "../calibration/calibration.service";

@Controller("admin/calibration")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminCalibrationController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly calibrationService: CalibrationService
  ) {}

  @Get("results")
  results() {
    return this.prisma.predictionCalibration.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  }

  @Get("curve")
  async curve(
    @Query("market") market = "match_outcome",
    @Query("horizon") horizon?: string,
    @Query("line") line?: string,
    @Query("selection") selection?: string,
    @Query("modelVersionId") modelVersionId?: string,
    @Query("bins") bins?: string,
    @Query("lookbackDays") lookbackDays?: string
  ) {
    const parsedLine = line === undefined ? undefined : Number(line);
    const parsedBins = bins === undefined ? undefined : Number(bins);
    const parsedLookback = lookbackDays === undefined ? undefined : Number(lookbackDays);
    return this.calibrationService.calibrationCurve({
      market,
      horizon,
      line: Number.isFinite(parsedLine) ? parsedLine : undefined,
      selection,
      modelVersionId,
      bins: Number.isFinite(parsedBins) ? parsedBins : undefined,
      lookbackDays: Number.isFinite(parsedLookback) ? parsedLookback : undefined
    });
  }

  @Post("run")
  async run(
    @Query("market") market = "match_outcome",
    @Query("horizon") horizon?: string,
    @Query("line") line?: string,
    @Query("selection") selection?: string,
    @Query("modelVersionId") modelVersionId?: string
  ) {
    const modelVersion =
      (modelVersionId
        ? await this.prisma.modelVersion.findUnique({ where: { id: modelVersionId } })
        : await this.prisma.modelVersion.findFirst({ orderBy: { createdAt: "desc" } })) ?? null;

    if (!modelVersion) {
      return { queued: false, message: "No model version found" };
    }

    const parsedLine = line === undefined ? undefined : Number(line);
    const curve = await this.calibrationService.calibrationCurve({
      market,
      horizon,
      line: Number.isFinite(parsedLine) ? parsedLine : undefined,
      selection,
      modelVersionId: modelVersion.id
    });

    return this.prisma.predictionCalibration.create({
      data: {
        modelVersionId: modelVersion.id,
        bucketReport: {
          market,
          horizon: horizon ?? null,
          selection: selection ?? null,
          line: Number.isFinite(parsedLine) ? parsedLine : null,
          bins: curve.bins,
          sampleSize: curve.sampleSize
        },
        brierScore: curve.brierScore,
        ece: curve.ece
      }
    });
  }
}
