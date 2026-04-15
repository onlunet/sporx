import { Injectable } from "@nestjs/common";
import { MatchStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../../prisma/prisma.service";
import { BasketballFeatureSnapshot, BasketballTeamFeatureSnapshot } from "./basketball-feature.types";

type BuildBasketballFeaturesInput = {
  matchId: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffAt: Date;
};

type RecentMatch = {
  id: string;
  leagueId: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  matchDateTimeUTC: Date;
};

type TeamStatRow = Prisma.BasketballTeamStatGetPayload<{
  select: {
    matchId: true;
    possessions: true;
    offensiveRating: true;
    defensiveRating: true;
    netRating: true;
    pace: true;
    effectiveFgPct: true;
    trueShootingPct: true;
    turnoverPct: true;
    offensiveReboundPct: true;
    defensiveReboundPct: true;
    freeThrowRate: true;
    threePointAttemptRate: true;
    pointsInPaint: true;
    secondChancePoints: true;
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
    travelLoad: true;
    overtimeLastGame: true;
  };
}>;

@Injectable()
export class BasketballFeatureEngineeringService {
  constructor(private readonly prisma: PrismaService) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private average(values: Array<number | null | undefined>, fallback: number) {
    const safe = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (safe.length === 0) {
      return fallback;
    }
    return safe.reduce((acc, value) => acc + value, 0) / safe.length;
  }

  private stdDev(values: number[], fallback = 0) {
    if (values.length <= 1) {
      return fallback;
    }
    const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
    const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private normalize01(value: number, min: number, max: number) {
    if (max <= min) {
      return 0.5;
    }
    return this.clamp((value - min) / (max - min), 0, 1);
  }

  private pointsFor(match: RecentMatch, teamId: string) {
    if (match.homeTeamId === teamId) {
      return match.homeScore;
    }
    if (match.awayTeamId === teamId) {
      return match.awayScore;
    }
    return null;
  }

  private pointsAgainst(match: RecentMatch, teamId: string) {
    if (match.homeTeamId === teamId) {
      return match.awayScore;
    }
    if (match.awayTeamId === teamId) {
      return match.homeScore;
    }
    return null;
  }

  private winScore(match: RecentMatch, teamId: string) {
    const pf = this.pointsFor(match, teamId);
    const pa = this.pointsAgainst(match, teamId);
    if (pf === null || pa === null) {
      return null;
    }
    return pf > pa ? 1 : 0;
  }

  private daysBetween(a: Date, b: Date) {
    return Math.max(0, (a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000));
  }

  private buildTeamFeatureSnapshot(
    teamId: string,
    kickoffAt: Date,
    recentMatches: RecentMatch[],
    statsByMatchId: Map<string, TeamStatRow>
  ): BasketballTeamFeatureSnapshot {
    const pointsForSeries = recentMatches
      .map((match) => this.pointsFor(match, teamId))
      .filter((value): value is number => typeof value === "number");
    const pointsAgainstSeries = recentMatches
      .map((match) => this.pointsAgainst(match, teamId))
      .filter((value): value is number => typeof value === "number");
    const winsSeries = recentMatches
      .map((match) => this.winScore(match, teamId))
      .filter((value): value is 0 | 1 => value !== null);

    const weightedForm =
      winsSeries.length === 0
        ? 0.5
        : winsSeries.reduce<number>((acc, win, index) => acc + win / (index + 1), 0) /
          winsSeries.reduce<number>((acc, _win, index) => acc + 1 / (index + 1), 0);
    const pointsForAvg = this.average(pointsForSeries, 106);
    const pointsAgainstAvg = this.average(pointsAgainstSeries, 106);
    const pointDiffSeries = pointsForSeries.map((value, index) => value - (pointsAgainstSeries[index] ?? value));
    const pointDiffAvg = this.average(pointDiffSeries, 0);
    const volatility = this.stdDev(pointDiffSeries, 8);

    const teamStats = recentMatches
      .map((match) => statsByMatchId.get(match.id))
      .filter((row): row is TeamStatRow => row !== undefined);
    const paceFromStats = this.average(
      teamStats.map((row) => row.pace ?? row.possessions),
      98
    );
    const possessions = this.average(teamStats.map((row) => row.possessions), paceFromStats);

    const offensiveRating = this.average(teamStats.map((row) => row.offensiveRating), (pointsForAvg / possessions) * 100);
    const defensiveRating = this.average(teamStats.map((row) => row.defensiveRating), (pointsAgainstAvg / possessions) * 100);
    const netRating = this.average(teamStats.map((row) => row.netRating), offensiveRating - defensiveRating);
    const restDays = recentMatches[0] ? this.daysBetween(kickoffAt, recentMatches[0].matchDateTimeUTC) : 7;
    const gamesInFourDays = recentMatches.filter((match) => this.daysBetween(kickoffAt, match.matchDateTimeUTC) <= 4).length;

    const fallbackTravelLoad = recentMatches.slice(0, 4).reduce((acc, match, index, array) => {
      if (index === 0) {
        return acc;
      }
      const prev = array[index - 1];
      const wasAway = prev.homeTeamId !== teamId;
      const isAway = match.homeTeamId !== teamId;
      return acc + (wasAway && isAway ? 0.16 : 0.08);
    }, 0.18);

    const travelLoad = this.average(teamStats.map((row) => row.travelLoad), fallbackTravelLoad);
    const lineupContinuityScore = this.average(teamStats.map((row) => row.lineupContinuityScore), 0.7);
    const playerAvailabilityScore = this.average(teamStats.map((row) => row.playerAvailabilityScore), 0.76);
    const topUsageAvailabilityScore = this.average(teamStats.map((row) => row.topUsageAvailabilityScore), 0.72);
    const overtimeHangover = teamStats[0]?.overtimeLastGame ?? false;

    return {
      teamId,
      sampleSize: recentMatches.length,
      pointsForAvg,
      pointsAgainstAvg,
      recentFormScore: this.clamp(weightedForm, 0, 1),
      attackMomentum: this.normalize01(pointsForAvg, 88, 124),
      defenseFragility: this.normalize01(pointsAgainstAvg, 88, 124),
      goalVolatility: this.normalize01(volatility, 3, 20),
      pace: this.clamp(paceFromStats, 85, 112),
      offensiveRating: this.clamp(offensiveRating, 90, 130),
      defensiveRating: this.clamp(defensiveRating, 90, 130),
      netRating: this.clamp(netRating, -25, 25),
      effectiveFgPct: this.average(teamStats.map((row) => row.effectiveFgPct), 0.52),
      trueShootingPct: this.average(teamStats.map((row) => row.trueShootingPct), 0.56),
      turnoverPct: this.average(teamStats.map((row) => row.turnoverPct), 0.135),
      offensiveReboundPct: this.average(teamStats.map((row) => row.offensiveReboundPct), 0.28),
      defensiveReboundPct: this.average(teamStats.map((row) => row.defensiveReboundPct), 0.72),
      freeThrowRate: this.average(teamStats.map((row) => row.freeThrowRate), 0.24),
      threePointAttemptRate: this.average(teamStats.map((row) => row.threePointAttemptRate), 0.39),
      pointsInPaint: this.average(teamStats.map((row) => row.pointsInPaint), 44),
      secondChancePoints: this.average(teamStats.map((row) => row.secondChancePoints), 12),
      fastBreakPoints: this.average(teamStats.map((row) => row.fastBreakPoints), 12),
      benchPoints: this.average(teamStats.map((row) => row.benchPoints), 29),
      assistRatio: this.average(teamStats.map((row) => row.assistRatio), 0.61),
      assistToTurnoverRatio: this.average(teamStats.map((row) => row.assistToTurnoverRatio), 1.65),
      stealRate: this.average(teamStats.map((row) => row.stealRate), 0.075),
      blockRate: this.average(teamStats.map((row) => row.blockRate), 0.05),
      foulRate: this.average(teamStats.map((row) => row.foulRate), 0.2),
      playerAvailabilityScore,
      topUsageAvailabilityScore,
      rotationStabilityScore: this.clamp((lineupContinuityScore + playerAvailabilityScore) / 2, 0, 1),
      lineupContinuityScore,
      restDays,
      backToBack: restDays < 1.2,
      thirdGameInFourNights: gamesInFourDays >= 3,
      travelLoad: this.clamp(travelLoad, 0, 1),
      overtimeHangover,
      opponentAdjustedStrength: this.clamp(0.5 + pointDiffAvg / 40, 0, 1)
    };
  }

  private async loadRecentMatches(teamId: string, kickoffAt: Date) {
    return this.prisma.match.findMany({
      where: {
        sport: { code: "basketball" },
        status: MatchStatus.finished,
        matchDateTimeUTC: { lt: kickoffAt },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }]
      },
      orderBy: { matchDateTimeUTC: "desc" },
      take: 12,
      select: {
        id: true,
        leagueId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        matchDateTimeUTC: true
      }
    });
  }

  async build(input: BuildBasketballFeaturesInput): Promise<BasketballFeatureSnapshot> {
    const [homeMatches, awayMatches] = await Promise.all([
      this.loadRecentMatches(input.homeTeamId, input.kickoffAt),
      this.loadRecentMatches(input.awayTeamId, input.kickoffAt)
    ]);
    const statMatchIds = Array.from(new Set([...homeMatches, ...awayMatches].map((match) => match.id)));
    const teamStats = statMatchIds.length
      ? await this.prisma.basketballTeamStat.findMany({
          where: {
            matchId: { in: statMatchIds },
            teamId: { in: [input.homeTeamId, input.awayTeamId] }
          },
          select: {
            matchId: true,
            possessions: true,
            offensiveRating: true,
            defensiveRating: true,
            netRating: true,
            pace: true,
            effectiveFgPct: true,
            trueShootingPct: true,
            turnoverPct: true,
            offensiveReboundPct: true,
            defensiveReboundPct: true,
            freeThrowRate: true,
            threePointAttemptRate: true,
            pointsInPaint: true,
            secondChancePoints: true,
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
            travelLoad: true,
            overtimeLastGame: true
          }
        })
      : [];

    const homeStatsByMatch = new Map(
      teamStats
        .filter((row) => homeMatches.some((match) => match.id === row.matchId))
        .map((row) => [row.matchId, row] as const)
    );
    const awayStatsByMatch = new Map(
      teamStats
        .filter((row) => awayMatches.some((match) => match.id === row.matchId))
        .map((row) => [row.matchId, row] as const)
    );

    const home = this.buildTeamFeatureSnapshot(input.homeTeamId, input.kickoffAt, homeMatches, homeStatsByMatch);
    const away = this.buildTeamFeatureSnapshot(input.awayTeamId, input.kickoffAt, awayMatches, awayStatsByMatch);

    const oddsStats = await this.prisma.oddsSnapshot.findMany({
      where: { matchId: input.matchId },
      orderBy: { capturedAt: "desc" },
      take: 80,
      select: {
        capturedAt: true
      }
    });

    const freshnessMinutes =
      oddsStats[0] !== undefined ? (Date.now() - oddsStats[0].capturedAt.getTime()) / (60 * 1000) : null;
    const oddsCoverage = this.clamp(oddsStats.length / 30, 0, 1);
    const oddsFreshnessScore =
      freshnessMinutes === null ? 0 : this.clamp(1 - freshnessMinutes / (6 * 60), 0, 1);
    const sampleQualityScore = this.clamp(
      ((home.sampleSize + away.sampleSize) / 24) * 0.5 +
        ((home.playerAvailabilityScore + away.playerAvailabilityScore) / 2) * 0.3 +
        ((home.rotationStabilityScore + away.rotationStabilityScore) / 2) * 0.2,
      0,
      1
    );

    const scheduleFatigueScore = this.clamp(
      (Number(home.backToBack) + Number(away.backToBack)) * 0.2 +
        (Number(home.thirdGameInFourNights) + Number(away.thirdGameInFourNights)) * 0.22 +
        (home.travelLoad + away.travelLoad) * 0.18,
      0,
      1
    );

    return {
      matchId: input.matchId,
      home,
      away,
      context: {
        playoff: false,
        mustWinPressure: 0.5,
        rivalryIntensity: 0.5,
        motivationScore: 0.5,
        scheduleFatigueScore,
        lineupCertaintyScore: this.clamp(
          (home.playerAvailabilityScore + away.playerAvailabilityScore + home.topUsageAvailabilityScore + away.topUsageAvailabilityScore) /
            4,
          0,
          1
        ),
        leagueDataQualityScore: this.clamp((home.sampleSize + away.sampleSize) / 20, 0, 1)
      },
      market: {
        oddsDataCoverage: oddsCoverage,
        oddsFreshnessScore,
        oddsSourceQualityScore: this.clamp((oddsCoverage + oddsFreshnessScore) / 2, 0, 1)
      },
      sampleQualityScore
    };
  }
}
