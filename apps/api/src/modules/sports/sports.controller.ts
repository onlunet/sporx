import { Controller, Get } from "@nestjs/common";
import { SportsService } from "./sports.service";

@Controller("sports")
export class SportsController {
  constructor(private readonly sportsService: SportsService) {}

  @Get()
  list() {
    return this.sportsService.listSports();
  }
}
