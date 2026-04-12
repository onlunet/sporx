import { Body, Controller, Get, Patch, UseGuards } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/system")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminSystemController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("settings")
  settings() {
    return this.prisma.systemSetting.findMany({ orderBy: { key: "asc" } });
  }

  @Patch("settings")
  async patchSettings(@Body() body: Array<{ key: string; value: unknown; description?: string }>) {
    const updates = [];
    for (const item of body) {
      const updated = await this.prisma.systemSetting.upsert({
        where: { key: item.key },
        update: { value: item.value as any, description: item.description },
        create: { key: item.key, value: item.value as any, description: item.description }
      });
      updates.push(updated);
    }
    return updates;
  }
}
