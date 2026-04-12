import { Controller, Get, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/predictions")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminPredictionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("failed")
  failed() {
    return this.prisma.failedPredictionAnalysis.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
  }

  @Get("low-confidence")
  lowConfidence() {
    return this.prisma.prediction.findMany({
      where: { isLowConfidence: true },
      orderBy: { confidenceScore: "asc" },
      take: 100
    });
  }
}
