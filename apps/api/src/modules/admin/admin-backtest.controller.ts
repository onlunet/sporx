import { Controller, Get, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/backtest")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminBacktestController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("results")
  results() {
    return this.prisma.backtestResult.findMany({ orderBy: { createdAt: "desc" }, take: 20 });
  }

  @Post("run")
  async run() {
    const modelVersion = await this.prisma.modelVersion.findFirst({ orderBy: { createdAt: "desc" } });
    if (!modelVersion) {
      return { queued: false, message: "No model version found" };
    }

    return this.prisma.backtestResult.create({
      data: {
        modelVersionId: modelVersion.id,
        rangeStart: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        rangeEnd: new Date(),
        metrics: { status: "queued" },
        summary: "Backtest queued"
      }
    });
  }
}
