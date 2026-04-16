import { Controller, Get, Param, Query } from "@nestjs/common";
import { TeamsService } from "./teams.service";

@Controller("teams")
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Get()
  list(@Query("q") q?: string, @Query("take") take?: string, @Query("sport") sport?: string) {
    const parsedTake = Number(take ?? "");
    const takeValue = Number.isFinite(parsedTake) ? parsedTake : undefined;
    return this.teamsService.list(q, takeValue, sport);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.teamsService.getById(id);
  }

  @Get(":id/matches")
  matches(@Param("id") id: string, @Query("sport") sport?: string) {
    return this.teamsService.matches(id, sport);
  }

  @Get(":id/form")
  form(@Param("id") id: string) {
    return this.teamsService.form(id);
  }
}
