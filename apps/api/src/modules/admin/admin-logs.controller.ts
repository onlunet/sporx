import { Controller, Get, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/logs")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminLogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("audit")
  audit() {
    return this.prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  }

  @Get("api")
  api() {
    return this.prisma.apiLog.findMany({ orderBy: { createdAt: "desc" }, take: 200 });
  }
}
