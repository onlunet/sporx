import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/calibration")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminCalibrationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("results")
  results() {
    return this.prisma.predictionCalibration.findMany({ orderBy: { createdAt: "desc" }, take: 30 });
  }

  @Post("run")
  async run() {
    const modelVersion = await this.prisma.modelVersion.findFirst({ orderBy: { createdAt: "desc" } });
    if (!modelVersion) {
      return { queued: false, message: "No model version found" };
    }

    return this.prisma.predictionCalibration.create({
      data: {
        modelVersionId: modelVersion.id,
        bucketReport: { note: "Calibration queued" },
        brierScore: null,
        ece: null
      }
    });
  }
}
