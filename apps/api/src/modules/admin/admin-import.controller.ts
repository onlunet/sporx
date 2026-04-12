import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { HistoricalImportService } from "../historical-import/historical-import.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/import")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminImportController {
  constructor(private readonly historicalImportService: HistoricalImportService) {}

  @Post("historical")
  runImport(@Body() body: { matchesPath: string; eloPath: string }) {
    return this.historicalImportService.importCsv(body.matchesPath, body.eloPath);
  }

  @Get("status")
  status() {
    return this.historicalImportService.status();
  }
}
