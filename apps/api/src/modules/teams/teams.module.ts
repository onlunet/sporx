import { Module } from "@nestjs/common";
import { TeamsController } from "./teams.controller";
import { TeamsService } from "./teams.service";
import { TeamIdentityService } from "./team-identity.service";

@Module({
  controllers: [TeamsController],
  providers: [TeamsService, TeamIdentityService],
  exports: [TeamsService, TeamIdentityService]
})
export class TeamsModule {}
