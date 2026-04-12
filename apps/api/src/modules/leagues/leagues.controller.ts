import { Controller, Get, Param } from "@nestjs/common";
import { LeaguesService } from "./leagues.service";

@Controller("leagues")
export class LeaguesController {
  constructor(private readonly leaguesService: LeaguesService) {}

  @Get()
  list() {
    return this.leaguesService.list();
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
