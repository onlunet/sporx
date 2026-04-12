import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IngestionService } from "../ingestion/ingestion.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

@Controller("admin/ingestion")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminIngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post("run")
  run(@Body() body: { jobType: string }) {
    return this.ingestionService.run(body.jobType);
  }

  @Get("jobs")
  jobs() {
    return this.ingestionService.listRuns();
  }
}
