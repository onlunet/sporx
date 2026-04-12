import { Controller, Get, Query } from "@nestjs/common";
import { TeamComparisonService } from "./team-comparison.service";

@Controller("compare")
export class TeamComparisonController {
  constructor(private readonly teamComparisonService: TeamComparisonService) {}

  @Get("teams")
  compare(@Query("homeTeamId") homeTeamId: string, @Query("awayTeamId") awayTeamId: string, @Query("seasonId") seasonId?: string) {
    return this.teamComparisonService.compareTeams(homeTeamId, awayTeamId, seasonId);
  }
}
