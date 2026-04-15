import { Controller, Get, Param, Query } from "@nestjs/common";
import { LeaguesService } from "./leagues.service";

@Controller("leagues")
export class LeaguesController {
  constructor(private readonly leaguesService: LeaguesService) {}

  @Get()
  list(@Query("take") take?: string) {
    const parsedTake = Number(take ?? "");
    const takeValue = Number.isFinite(parsedTake) ? parsedTake : undefined;
    return this.leaguesService.list(takeValue);
  }

  @Get(":id")
  get(@Param("id") id: string) {
    return this.leaguesService.getById(id);
  }

  @Get(":id/standings")
  standings(@Param("id") id: string) {
    return this.leaguesService.getStandings(id);
  }
}