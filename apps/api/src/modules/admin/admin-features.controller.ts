import { Prisma } from "@prisma/client";
import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/features")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminFeaturesController {
  constructor(private readonly prisma: PrismaService) {}

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
}
