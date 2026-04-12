import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { TeamIdentityService } from "./team-identity.service";

@Injectable()
export class TeamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamIdentityService: TeamIdentityService
  ) {}

  async list(query?: string, take?: number) {
    const safeTake = Number.isFinite(take ?? NaN) ? Math.max(50, Math.min(10000, Math.floor(take ?? 0))) : 10000;
    const teams = await this.teamIdentityService.listCanonicalTeams(safeTake);
    const normalizedQuery = String(query ?? "").trim();
    if (!normalizedQuery) {
      return teams;
    }

    const normalizeText = (value: string) =>
      value
        .toLocaleLowerCase("tr-TR")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();

    const needle = normalizeText(normalizedQuery);
    return teams.filter((team) =>
      [team.name, team.shortName ?? "", team.country ?? ""]
        .map((item) => normalizeText(item))
        .some((item) => item.includes(needle))
    );
  }

  async getById(id: string) {
    const resolved = await this.teamIdentityService.resolveCanonicalTeam(id);
    return resolved.canonicalTeam;
  }

  async matches(id: string) {
    const equivalentIds = await this.teamIdentityService.resolveEquivalentTeamIds(id);
    return this.prisma.match.findMany({
      where: {
        OR: [{ homeTeamId: { in: equivalentIds } }, { awayTeamId: { in: equivalentIds } }]
      },
      orderBy: { matchDateTimeUTC: "desc" },
      take: 20,
      include: { homeTeam: true, awayTeam: true, league: true }
    });
  }

  async form(id: string) {
    const resolved = await this.teamIdentityService.resolveCanonicalTeam(id);
    const equivalentIds = resolved.equivalentIds;
    const teamIdSet = new Set(equivalentIds);

    const matches = await this.prisma.match.findMany({
      where: {
        status: "finished",
        OR: [{ homeTeamId: { in: equivalentIds } }, { awayTeamId: { in: equivalentIds } }]
      },
      orderBy: { matchDateTimeUTC: "desc" },
      take: 5
    });

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
  }
}
