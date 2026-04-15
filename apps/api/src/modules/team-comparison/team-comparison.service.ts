import { Injectable, NotFoundException } from "@nestjs/common";
import { CacheService } from "../../cache/cache.service";
import { TeamIdentityService } from "../teams/team-identity.service";
import { TeamComparisonStrategyRegistry } from "./sport-strategies/team-comparison-strategy.registry";

@Injectable()
export class TeamComparisonService {
  constructor(
    private readonly cache: CacheService,
    private readonly teamIdentityService: TeamIdentityService,
    private readonly strategyRegistry: TeamComparisonStrategyRegistry
  ) {}

  async compareTeams(homeTeamId: string, awayTeamId: string, seasonId?: string, sport?: string) {
    if (!homeTeamId || !awayTeamId) {
      throw new NotFoundException("Takim secimi eksik.");
    }

    const [homeResolved, awayResolved] = await Promise.all([
      this.teamIdentityService.resolveCanonicalTeam(homeTeamId),
      this.teamIdentityService.resolveCanonicalTeam(awayTeamId)
    ]);

    if (homeResolved.canonicalId === awayResolved.canonicalId) {
      throw new NotFoundException("Ayni takimi karsilastirmak mumkun degil.");
    }

    const strategy = this.strategyRegistry.forSport(sport);
    const cacheKey = `compare:${strategy.sport}:${homeResolved.canonicalId}:${awayResolved.canonicalId}:${seasonId ?? "none"}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) {
      return cached;
    }

    const result = await strategy.compare({
      homeResolved,
      awayResolved,
      seasonId
    });

    await this.cache.set(cacheKey, result, 300, ["compare"]);
    return result;
  }
}

