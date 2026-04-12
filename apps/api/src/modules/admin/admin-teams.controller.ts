import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { TeamIdentityService } from "../teams/team-identity.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";

type TeamIdentityRuleActionBody = {
  action: "merge_group" | "unmerge_group" | "block_pair" | "unblock_pair";
  teamIds?: string[] | string;
  leftTeamId?: string;
  rightTeamId?: string;
};

@Controller("admin/teams")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminTeamsController {
  constructor(private readonly teamIdentityService: TeamIdentityService) {}

  @Get("identity/issues")
  issues(@Query("limit") limit?: string) {
    const parsedLimit = Number(limit ?? 120);
    const safeLimit = Number.isFinite(parsedLimit) ? Math.max(20, Math.min(300, Math.floor(parsedLimit))) : 120;
    return this.teamIdentityService.getIdentityIssues(safeLimit);
  }

  @Get("identity/rules")
  rules() {
    return this.teamIdentityService.getRules();
  }

  @Post("identity/rules/action")
  applyRuleAction(@Body() body: TeamIdentityRuleActionBody) {
    return this.teamIdentityService.applyRuleAction(body);
  }
}

