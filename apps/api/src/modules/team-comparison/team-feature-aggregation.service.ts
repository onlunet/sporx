import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ProxyXGService } from "./proxy-xg.service";

type TeamFeatureAggregate = {
  offense: number;
  defense: number;
  tempo: number;
  setPiece: number;
  transition: number;
  form: number;
  sampleSize: number;
  scoredSampleSize: number;
  fallbackUsed: boolean;
};

@Injectable()
export class TeamFeatureAggregationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly proxyXgService: ProxyXGService
  ) {}

  private neutralBaseline(sampleSize = 0, fallbackUsed = true): TeamFeatureAggregate {
    return {
      offense: 0.95,
      defense: 0.95,
      tempo: 0.95,
      setPiece: 0.5,
      transition: 0.5,
      form: 0.5,
      sampleSize,
      scoredSampleSize: 0,
      fallbackUsed
    };
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number(value.toFixed(4))));
  }

  async aggregate(teamIds: string[], canonicalTeamId: string, seasonId?: string): Promise<TeamFeatureAggregate> {
    const uniqueTeamIds = Array.from(new Set(teamIds.filter((teamId) => teamId.trim().length > 0)));
    if (uniqueTeamIds.length === 0) {
      return this.neutralBaseline(0, true);
    }
    if (!uniqueTeamIds.includes(canonicalTeamId)) {
      uniqueTeamIds.push(canonicalTeamId);
    }
    const teamIdSet = new Set(uniqueTeamIds);

    const baseWhere: Prisma.MatchWhereInput = {
      status: "finished",
      OR: [{ homeTeamId: { in: uniqueTeamIds } }, { awayTeamId: { in: uniqueTeamIds } }]
    };

    const seasonalMatches = await this.prisma.match.findMany({
      where: seasonId ? { ...baseWhere, seasonId } : baseWhere,
      orderBy: { matchDateTimeUTC: "desc" },
      take: 12,
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true
      }
    });

    let matches = seasonalMatches;
    let fallbackUsed = false;

    if (seasonId && matches.length < 6) {
      const extra = await this.prisma.match.findMany({
        where: {
          ...baseWhere,
          id: { notIn: matches.map((item) => item.id) }
        },
        orderBy: { matchDateTimeUTC: "desc" },
        take: 12 - matches.length,
        select: {
          id: true,
          homeTeamId: true,
          awayTeamId: true,
          homeScore: true,
          awayScore: true
        }
      });
      matches = [...matches, ...extra];
      fallbackUsed = extra.length > 0;
    }

    if (matches.length === 0) {
      return this.neutralBaseline(0, true);
    }

    let points = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;
    let scoredSampleSize = 0;

    for (const match of matches) {
      if (match.homeScore === null || match.awayScore === null) {
        continue;
      }

      const homeInSet = teamIdSet.has(match.homeTeamId);
      const awayInSet = teamIdSet.has(match.awayTeamId);
      if (homeInSet === awayInSet) {
        continue;
      }

      const isHome = homeInSet;
      const gf = isHome ? match.homeScore : match.awayScore;
      const ga = isHome ? match.awayScore : match.homeScore;
      goalsFor += gf;
      goalsAgainst += ga;
      scoredSampleSize += 1;
      if (gf > ga) points += 3;
      else if (gf === ga) points += 1;
    }

    if (scoredSampleSize === 0) {
      return this.neutralBaseline(matches.length, true);
    }

    const xg = this.proxyXgService.estimate(goalsFor, goalsAgainst, scoredSampleSize);
    const avgGoalsFor = goalsFor / scoredSampleSize;
    const avgGoalsAgainst = goalsAgainst / scoredSampleSize;
    const form = points / (scoredSampleSize * 3);

    return {
      offense: this.clamp(xg.attack, 0.35, 1.9),
      defense: this.clamp(xg.defense, 0.35, 1.9),
      tempo: this.clamp((avgGoalsFor + avgGoalsAgainst) / 2, 0.3, 1.8),
      setPiece: this.clamp(0.45 + avgGoalsFor * 0.18, 0.3, 1.35),
      transition: this.clamp(0.5 + (avgGoalsFor - avgGoalsAgainst) * 0.22, 0.2, 1.25),
      form: this.clamp(form, 0, 1),
      sampleSize: matches.length,
      scoredSampleSize,
      fallbackUsed
    };
  }
}
