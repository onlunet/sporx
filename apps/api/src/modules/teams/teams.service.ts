import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { TeamIdentityService } from "./team-identity.service";
import { CacheService } from "../../cache/cache.service";

async function queryWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`query_timeout_${timeoutMs}`)), timeoutMs);
    })
  ]);
}

function parseSportFilter(input?: string): "football" | "basketball" | undefined {
  if (!input) {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (normalized === "football" || normalized === "soccer") {
    return "football";
  }
  if (normalized === "basketball" || normalized === "nba" || normalized === "basket") {
    return "basketball";
  }
  return undefined;
}

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamIdentityService: TeamIdentityService,
    private readonly cache: CacheService
  ) {}

  async list(query?: string, take?: number, sport?: string) {
    const safeTake = Number.isFinite(take ?? NaN) ? Math.max(50, Math.min(10000, Math.floor(take ?? 0))) : 10000;
    const normalizedQuery = String(query ?? "").trim();
    const queryKey = normalizedQuery.toLocaleLowerCase("tr-TR") || "all";
    const sportCode = parseSportFilter(sport);
    const sportKey = sportCode ?? "all";
    const cacheKey = `teams:list:v3:${safeTake}:${queryKey}:${sportKey}`;
    const stableCacheKey = `${cacheKey}:stable`;
    const cached = await this.cache.get<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const normalizeText = (value: string) =>
      value
        .toLocaleLowerCase("tr-TR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

    const applyQueryFilter = <T extends { name: string; shortName: string | null; country: string | null }>(items: T[]) => {
      if (!normalizedQuery) {
        return items;
      }
      const needle = normalizeText(normalizedQuery);
      return items.filter((team) =>
        [team.name, team.shortName ?? "", team.country ?? ""]
          .map((item) => normalizeText(item))
          .some((item) => item.includes(needle))
      );
    };

    if (sportCode) {
      try {
        const rows = await queryWithTimeout(
          this.prisma.team.findMany({
            where: {
              OR: [
                { homeMatches: { some: { sport: { code: sportCode } } } },
                { awayMatches: { some: { sport: { code: sportCode } } } }
              ]
            },
            select: {
              id: true,
              name: true,
              shortName: true,
              country: true
            },
            orderBy: [{ name: "asc" }, { id: "asc" }],
            take: safeTake
          }),
          12000
        );

        const filtered = applyQueryFilter(rows);
        await this.cache.set(cacheKey, filtered, 90, ["teams"]);
        await this.cache.set(stableCacheKey, filtered, 600, ["teams"]);
        return filtered;
      } catch {
        const stale = await this.cache.get<unknown[]>(stableCacheKey);
        if (stale) {
          await this.cache.set(cacheKey, stale, 12, ["teams"]);
          return stale;
        }
        return [];
      }
    }

    let teams: Array<{ id: string; name: string; shortName: string | null; country: string | null }> = [];
    try {
      teams = await queryWithTimeout(this.teamIdentityService.listCanonicalTeams(safeTake), 6500);
    } catch {
      try {
        const fallbackTake = Math.min(safeTake, 2000);
        const fallback = await queryWithTimeout(
          this.prisma.team.findMany({
            select: {
              id: true,
              name: true,
              shortName: true,
              country: true
            },
            orderBy: { id: "asc" },
            take: fallbackTake
          }),
          6500
        );
        const filteredFallback = applyQueryFilter(fallback);
        await this.cache.set(cacheKey, filteredFallback, 90, ["teams"]);
        await this.cache.set(stableCacheKey, filteredFallback, 600, ["teams"]);
        return filteredFallback;
      } catch {
        const stale = await this.cache.get<unknown[]>(stableCacheKey);
        if (stale) {
          await this.cache.set(cacheKey, stale, 12, ["teams"]);
          return stale;
        }
        return [];
      }
    }

    const filtered = applyQueryFilter(teams);
    await this.cache.set(cacheKey, filtered, 90, ["teams"]);
    await this.cache.set(stableCacheKey, filtered, 600, ["teams"]);
    return filtered;
  }

  async getById(id: string) {
    const resolved = await this.teamIdentityService.resolveCanonicalTeam(id);
    return resolved.canonicalTeam;
  }

  async matches(id: string, sport?: string) {
    try {
      const equivalentIds = await queryWithTimeout(this.teamIdentityService.resolveEquivalentTeamIds(id), 6000);
      const sportCode = parseSportFilter(sport);
      const where = {
        OR: [{ homeTeamId: { in: equivalentIds } }, { awayTeamId: { in: equivalentIds } }],
        ...(sportCode ? { sport: { code: sportCode } } : {})
      };
      return await queryWithTimeout(
        this.prisma.match.findMany({
          where,
          orderBy: { matchDateTimeUTC: "desc" },
          take: 20,
          include: { homeTeam: true, awayTeam: true, league: true }
        }),
        9000
      );
    } catch {
      return [];
    }
  }

  async form(id: string) {
    try {
      const resolved = await queryWithTimeout(this.teamIdentityService.resolveCanonicalTeam(id), 6000);
      const equivalentIds = resolved.equivalentIds;
      const teamIdSet = new Set(equivalentIds);

      const matches = await queryWithTimeout(
        this.prisma.match.findMany({
          where: {
            status: "finished",
            OR: [{ homeTeamId: { in: equivalentIds } }, { awayTeamId: { in: equivalentIds } }]
          },
          orderBy: { matchDateTimeUTC: "desc" },
          take: 5
        }),
        9000
      );

      const points = matches.reduce(
        (
          acc: number,
          match: { homeScore: number | null; awayScore: number | null; homeTeamId: string; awayTeamId: string }
        ) => {
          if (match.homeScore === null || match.awayScore === null) {
            return acc;
          }

          const homeInSet = teamIdSet.has(match.homeTeamId);
          const awayInSet = teamIdSet.has(match.awayTeamId);
          if (homeInSet === awayInSet) {
            return acc;
          }

          const goalsFor = homeInSet ? match.homeScore : match.awayScore;
          const goalsAgainst = homeInSet ? match.awayScore : match.homeScore;
          if (goalsFor > goalsAgainst) return acc + 3;
          if (goalsFor === goalsAgainst) return acc + 1;
          return acc;
        },
        0
      );

      return {
        teamId: resolved.canonicalId,
        matches: matches.length,
        points,
        avgPoints: matches.length > 0 ? points / matches.length : 0
      };
    } catch {
      return {
        teamId: id,
        matches: 0,
        points: 0,
        avgPoints: 0
      };
    }
  }
}
