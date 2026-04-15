import { Injectable } from "@nestjs/common";
import { MatchStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

export type BasketballTeamFeatureAggregate = {
  shotQualityCreation: number;
  halfCourtOffense: number;
  transitionOffense: number;
  rimPressure: number;
  perimeterShotProfile: number;
  turnoverControl: number;
  offensiveRebounding: number;
  defensiveRebounding: number;
  rimDefense: number;
  perimeterDefense: number;
  foulDiscipline: number;
  benchImpact: number;
  starPowerReliability: number;
  paceControl: number;
  clutchStability: number;
  scheduleFreshness: number;
  sampleSize: number;
  scoredSampleSize: number;
  fallbackUsed: boolean;
};

type TeamPerspectiveMatch = {
  matchId: string;
  playedAt: Date;
  pointsFor: number;
  pointsAgainst: number;
};

type TeamStatRow = Prisma.BasketballTeamStatGetPayload<{
  select: {
    matchId: true;
    pace: true;
    possessions: true;
    offensiveRating: true;
    defensiveRating: true;
    netRating: true;
    effectiveFgPct: true;
    trueShootingPct: true;
    turnoverPct: true;
    offensiveReboundPct: true;
    defensiveReboundPct: true;
    freeThrowRate: true;
    threePointAttemptRate: true;
    pointsInPaint: true;
    fastBreakPoints: true;
    benchPoints: true;
    assistRatio: true;
    assistToTurnoverRatio: true;
    stealRate: true;
    blockRate: true;
    foulRate: true;
    playerAvailabilityScore: true;
    topUsageAvailabilityScore: true;
    lineupContinuityScore: true;
    backToBack: true;
    thirdGameInFourNights: true;
    travelLoad: true;
  };
}>;

@Injectable()
export class BasketballTeamFeatureAggregationService {
  constructor(private readonly prisma: PrismaService) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number(value.toFixed(4))));
  }

  private normalize01(value: number, min: number, max: number) {
    if (max <= min) {
      return 0.5;
    }
    return this.clamp((value - min) / (max - min), 0, 1);
  }

  private average(values: Array<number | null | undefined>, fallback: number) {
    const safe = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (safe.length === 0) {
      return fallback;
    }
    return safe.reduce((acc, value) => acc + value, 0) / safe.length;
  }

  private neutralBaseline(sampleSize = 0, fallbackUsed = true): BasketballTeamFeatureAggregate {
    return {
      shotQualityCreation: 0.5,
      halfCourtOffense: 0.5,
      transitionOffense: 0.5,
      rimPressure: 0.5,
      perimeterShotProfile: 0.5,
      turnoverControl: 0.5,
      offensiveRebounding: 0.5,
      defensiveRebounding: 0.5,
      rimDefense: 0.5,
      perimeterDefense: 0.5,
      foulDiscipline: 0.5,
      benchImpact: 0.5,
      starPowerReliability: 0.5,
      paceControl: 0.5,
      clutchStability: 0.5,
      scheduleFreshness: 0.5,
      sampleSize,
      scoredSampleSize: 0,
      fallbackUsed
    };
  }

  private asTeamPerspective(
    match: {
      id: string;
      matchDateTimeUTC: Date;
      homeTeamId: string;
      awayTeamId: string;
      homeScore: number | null;
      awayScore: number | null;
    },
    teamIdSet: Set<string>
  ): TeamPerspectiveMatch | null {
    if (match.homeScore === null || match.awayScore === null) {
      return null;
    }

    const homeInSet = teamIdSet.has(match.homeTeamId);
    const awayInSet = teamIdSet.has(match.awayTeamId);
    if (homeInSet === awayInSet) {
      return null;
    }

    const isHome = homeInSet;
    return {
      matchId: match.id,
      playedAt: match.matchDateTimeUTC,
      pointsFor: isHome ? match.homeScore : match.awayScore,
      pointsAgainst: isHome ? match.awayScore : match.homeScore
    };
  }

  async aggregate(teamIds: string[], canonicalTeamId: string, seasonId?: string): Promise<BasketballTeamFeatureAggregate> {
    const uniqueTeamIds = Array.from(new Set(teamIds.filter((teamId) => teamId.trim().length > 0)));
    if (!uniqueTeamIds.includes(canonicalTeamId)) {
      uniqueTeamIds.push(canonicalTeamId);
    }
    if (uniqueTeamIds.length === 0) {
      return this.neutralBaseline(0, true);
    }

    const baseWhere: Prisma.MatchWhereInput = {
      status: MatchStatus.finished,
      sport: { code: "basketball" },
      OR: [{ homeTeamId: { in: uniqueTeamIds } }, { awayTeamId: { in: uniqueTeamIds } }]
    };

    const seasonalMatches = await this.prisma.match.findMany({
      where: seasonId ? { ...baseWhere, seasonId } : baseWhere,
      orderBy: { matchDateTimeUTC: "desc" },
      take: 18,
      select: {
        id: true,
        matchDateTimeUTC: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true
      }
    });

    let matches = seasonalMatches;
    let fallbackUsed = false;
    if (seasonId && matches.length < 8) {
      const extra = await this.prisma.match.findMany({
        where: {
          ...baseWhere,
          id: { notIn: matches.map((item) => item.id) }
        },
        orderBy: { matchDateTimeUTC: "desc" },
        take: 18 - matches.length,
        select: {
          id: true,
          matchDateTimeUTC: true,
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

    const teamIdSet = new Set(uniqueTeamIds);
    const perspective = matches
      .map((match) => this.asTeamPerspective(match, teamIdSet))
      .filter((item): item is TeamPerspectiveMatch => item !== null);

    if (perspective.length === 0) {
      return this.neutralBaseline(matches.length, true);
    }

    const statRowsRaw = await this.prisma.basketballTeamStat.findMany({
      where: {
        teamId: { in: uniqueTeamIds },
        matchId: { in: perspective.map((item) => item.matchId) }
      },
      select: {
        matchId: true,
        pace: true,
        possessions: true,
        offensiveRating: true,
        defensiveRating: true,
        netRating: true,
        effectiveFgPct: true,
        trueShootingPct: true,
        turnoverPct: true,
        offensiveReboundPct: true,
        defensiveReboundPct: true,
        freeThrowRate: true,
        threePointAttemptRate: true,
        pointsInPaint: true,
        fastBreakPoints: true,
        benchPoints: true,
        assistRatio: true,
        assistToTurnoverRatio: true,
        stealRate: true,
        blockRate: true,
        foulRate: true,
        playerAvailabilityScore: true,
        topUsageAvailabilityScore: true,
        lineupContinuityScore: true,
        backToBack: true,
        thirdGameInFourNights: true,
        travelLoad: true
      }
    });

    const statsByMatchId = new Map<string, TeamStatRow>();
    for (const row of statRowsRaw) {
      if (!statsByMatchId.has(row.matchId)) {
        statsByMatchId.set(row.matchId, row);
      }
    }
    const statRows = perspective
      .map((item) => statsByMatchId.get(item.matchId))
      .filter((item): item is TeamStatRow => item !== undefined);

    const pointsForAvg = this.average(perspective.map((item) => item.pointsFor), 106);
    const pointsAgainstAvg = this.average(perspective.map((item) => item.pointsAgainst), 106);
    const pointDiffSeries = perspective.map((item) => item.pointsFor - item.pointsAgainst);
    const closeGames = perspective.filter((item) => Math.abs(item.pointsFor - item.pointsAgainst) <= 5);
    const clutchWinRate =
      closeGames.length > 0
        ? closeGames.filter((item) => item.pointsFor > item.pointsAgainst).length / closeGames.length
        : 0.5;

    const pace = this.average(
      statRows.map((row) => row.pace ?? row.possessions),
      98
    );
    const possessions = this.average(statRows.map((row) => row.possessions), pace);
    const offensiveRating = this.average(statRows.map((row) => row.offensiveRating), (pointsForAvg / possessions) * 100);
    const defensiveRating = this.average(statRows.map((row) => row.defensiveRating), (pointsAgainstAvg / possessions) * 100);
    const netRating = this.average(statRows.map((row) => row.netRating), offensiveRating - defensiveRating);
    const efg = this.average(statRows.map((row) => row.effectiveFgPct), 0.525);
    const ts = this.average(statRows.map((row) => row.trueShootingPct), 0.56);
    const turnoverPct = this.average(statRows.map((row) => row.turnoverPct), 0.136);
    const offRebPct = this.average(statRows.map((row) => row.offensiveReboundPct), 0.28);
    const defRebPct = this.average(statRows.map((row) => row.defensiveReboundPct), 0.71);
    const freeThrowRate = this.average(statRows.map((row) => row.freeThrowRate), 0.23);
    const threePaRate = this.average(statRows.map((row) => row.threePointAttemptRate), 0.39);
    const pointsInPaint = this.average(statRows.map((row) => row.pointsInPaint), 44);
    const fastBreakPoints = this.average(statRows.map((row) => row.fastBreakPoints), 12);
    const benchPoints = this.average(statRows.map((row) => row.benchPoints), 30);
    const assistRatio = this.average(statRows.map((row) => row.assistRatio), 0.61);
    const astToRatio = this.average(statRows.map((row) => row.assistToTurnoverRatio), 1.65);
    const stealRate = this.average(statRows.map((row) => row.stealRate), 0.075);
    const blockRate = this.average(statRows.map((row) => row.blockRate), 0.05);
    const foulRate = this.average(statRows.map((row) => row.foulRate), 0.2);
    const playerAvailability = this.average(statRows.map((row) => row.playerAvailabilityScore), 0.76);
    const topUsageAvailability = this.average(statRows.map((row) => row.topUsageAvailabilityScore), 0.74);
    const lineupContinuity = this.average(statRows.map((row) => row.lineupContinuityScore), 0.7);
    const backToBackRate = this.average(statRows.map((row) => (row.backToBack ? 1 : 0)), 0.2);
    const thirdInFourRate = this.average(statRows.map((row) => (row.thirdGameInFourNights ? 1 : 0)), 0.15);
    const travelLoad = this.average(statRows.map((row) => row.travelLoad), 0.26);
    const lastPlayedAt = perspective[0]?.playedAt ?? null;
    const restDays =
      lastPlayedAt === null ? 4 : Math.max(0, (Date.now() - lastPlayedAt.getTime()) / (24 * 60 * 60 * 1000));

    const shotQualityCreation =
      this.normalize01(efg, 0.45, 0.62) * 0.55 + this.normalize01(ts, 0.5, 0.67) * 0.45;
    const halfCourtOffense =
      this.normalize01(offensiveRating, 95, 125) * 0.5 +
      this.normalize01(assistRatio, 0.48, 0.75) * 0.3 +
      this.normalize01(pointsForAvg - fastBreakPoints, 80, 115) * 0.2;
    const transitionOffense =
      this.normalize01(fastBreakPoints, 6, 22) * 0.55 + this.normalize01(pace, 90, 108) * 0.45;
    const rimPressure =
      this.normalize01(pointsInPaint, 30, 62) * 0.6 + this.normalize01(freeThrowRate, 0.14, 0.38) * 0.4;
    const perimeterShotProfile =
      this.normalize01(threePaRate, 0.25, 0.55) * 0.6 + this.normalize01(efg, 0.45, 0.62) * 0.4;
    const turnoverControl =
      (1 - this.normalize01(turnoverPct, 0.09, 0.2)) * 0.62 + this.normalize01(astToRatio, 1, 2.7) * 0.38;
    const offensiveRebounding = this.normalize01(offRebPct, 0.18, 0.38);
    const defensiveRebounding = this.normalize01(defRebPct, 0.6, 0.82);
    const rimDefense =
      this.normalize01(blockRate, 0.02, 0.1) * 0.55 + (1 - this.normalize01(pointsAgainstAvg, 92, 124)) * 0.45;
    const perimeterDefense =
      this.normalize01(stealRate, 0.04, 0.12) * 0.45 + (1 - this.normalize01(defensiveRating, 98, 124)) * 0.55;
    const foulDiscipline = 1 - this.normalize01(foulRate, 0.14, 0.28);
    const benchImpact = this.normalize01(benchPoints, 14, 52);
    const starPowerReliability = playerAvailability * 0.5 + topUsageAvailability * 0.3 + lineupContinuity * 0.2;
    const paceControl = (1 - Math.min(1, Math.abs(pace - 99) / 15)) * 0.55 + turnoverControl * 0.45;
    const clutchStability = this.clamp(clutchWinRate * 0.62 + this.normalize01(netRating, -20, 20) * 0.38, 0, 1);
    const scheduleFreshness =
      (1 - backToBackRate) * 0.32 +
      (1 - thirdInFourRate) * 0.22 +
      (1 - this.normalize01(travelLoad, 0, 1)) * 0.24 +
      this.normalize01(restDays, 1, 5) * 0.22;

    const volatility = this.average(pointDiffSeries.map((value) => Math.abs(value)), 10);
    const volatilityPenalty = this.normalize01(volatility, 6, 24) * 0.08;

    return {
      shotQualityCreation: this.clamp(shotQualityCreation - volatilityPenalty, 0, 1),
      halfCourtOffense: this.clamp(halfCourtOffense, 0, 1),
      transitionOffense: this.clamp(transitionOffense, 0, 1),
      rimPressure: this.clamp(rimPressure, 0, 1),
      perimeterShotProfile: this.clamp(perimeterShotProfile, 0, 1),
      turnoverControl: this.clamp(turnoverControl, 0, 1),
      offensiveRebounding: this.clamp(offensiveRebounding, 0, 1),
      defensiveRebounding: this.clamp(defensiveRebounding, 0, 1),
      rimDefense: this.clamp(rimDefense, 0, 1),
      perimeterDefense: this.clamp(perimeterDefense, 0, 1),
      foulDiscipline: this.clamp(foulDiscipline, 0, 1),
      benchImpact: this.clamp(benchImpact, 0, 1),
      starPowerReliability: this.clamp(starPowerReliability, 0, 1),
      paceControl: this.clamp(paceControl, 0, 1),
      clutchStability: this.clamp(clutchStability, 0, 1),
      scheduleFreshness: this.clamp(scheduleFreshness, 0, 1),
      sampleSize: matches.length,
      scoredSampleSize: perspective.length,
      fallbackUsed
    };
  }
}
