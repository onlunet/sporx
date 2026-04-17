import { Injectable, Logger } from "@nestjs/common";
import { MatchStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { isLivePredictionHorizon } from "./prediction-horizon.util";

const FEATURE_SET_VERSION = "football_feature_snapshot_v1";

type BuildFeatureSnapshotInput = {
  matchId: string;
  horizon: string;
  featureCutoffAt: Date;
};

type TeamPerspectiveMatch = {
  matchId: string;
  isHome: boolean;
  playedAt: Date;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
};

type CoverageFlags = {
  has_odds: boolean;
  has_lineup: boolean;
  missing_stats_ratio: number;
  source_rows: number;
  odds_rows: number;
};

type SnapshotCoverageSummary = {
  generatedAt: Date;
  cutoffAt: Date;
  freshnessScore: number;
  coverage: CoverageFlags;
};

@Injectable()
export class FeatureSnapshotService {
  private readonly logger = new Logger(FeatureSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private asRecord(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return null;
  }

  private asNumber(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private normalizeCutoff(date: Date) {
    const normalizedMs = Math.floor(date.getTime() / 1000) * 1000;
    return new Date(normalizedMs);
  }

  private stableStringify(value: unknown): string {
    if (value === null || value === undefined) {
      return "null";
    }
    if (typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(",")}}`;
  }

  private hashFeatures(features: Record<string, unknown>) {
    const payload = this.stableStringify(features);
    return createHash("sha256").update(payload).digest("hex");
  }

  private parseOutcome(pointsHome: number, pointsAway: number) {
    if (pointsHome > pointsAway) {
      return { home: 3, away: 0 };
    }
    if (pointsHome < pointsAway) {
      return { home: 0, away: 3 };
    }
    return { home: 1, away: 1 };
  }

  private toTeamPerspective(
    matches: Array<{
      id: string;
      matchDateTimeUTC: Date;
      homeTeamId: string;
      awayTeamId: string;
      homeScore: number | null;
      awayScore: number | null;
    }>,
    teamId: string
  ): TeamPerspectiveMatch[] {
    const output: TeamPerspectiveMatch[] = [];
    for (const match of matches) {
      if (match.homeScore === null || match.awayScore === null) {
        continue;
      }
      const isHome = match.homeTeamId === teamId;
      if (!isHome && match.awayTeamId !== teamId) {
        continue;
      }
      const goalsFor = isHome ? match.homeScore : match.awayScore;
      const goalsAgainst = isHome ? match.awayScore : match.homeScore;
      const outcome = this.parseOutcome(goalsFor, goalsAgainst);
      output.push({
        matchId: match.id,
        isHome,
        playedAt: match.matchDateTimeUTC,
        goalsFor,
        goalsAgainst,
        points: isHome ? outcome.home : outcome.away
      });
    }
    return output.sort((left, right) => right.playedAt.getTime() - left.playedAt.getTime());
  }

  private avg(values: number[]) {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private std(values: number[]) {
    if (values.length <= 1) {
      return 0;
    }
    const mean = this.avg(values);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private round(value: number, digits = 4) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private formWindow(entries: TeamPerspectiveMatch[], size: number) {
    const window = entries.slice(0, size);
    if (window.length === 0) {
      return {
        sample: 0,
        pointsPerGame: 0,
        goalsForAvg: 0,
        goalsAgainstAvg: 0,
        goalDiffAvg: 0,
        winRate: 0
      };
    }
    const points = window.map((item) => item.points);
    const goalsFor = window.map((item) => item.goalsFor);
    const goalsAgainst = window.map((item) => item.goalsAgainst);
    const wins = window.filter((item) => item.goalsFor > item.goalsAgainst).length;
    return {
      sample: window.length,
      pointsPerGame: this.round(this.avg(points)),
      goalsForAvg: this.round(this.avg(goalsFor)),
      goalsAgainstAvg: this.round(this.avg(goalsAgainst)),
      goalDiffAvg: this.round(this.avg(goalsFor) - this.avg(goalsAgainst)),
      winRate: this.round(wins / window.length)
    };
  }

  private splitSummary(entries: TeamPerspectiveMatch[], wantHome: boolean) {
    const split = entries.filter((item) => item.isHome === wantHome).slice(0, 10);
    if (split.length === 0) {
      return {
        sample: 0,
        pointsPerGame: 0,
        goalsForAvg: 0,
        goalsAgainstAvg: 0
      };
    }
    return {
      sample: split.length,
      pointsPerGame: this.round(this.avg(split.map((item) => item.points))),
      goalsForAvg: this.round(this.avg(split.map((item) => item.goalsFor))),
      goalsAgainstAvg: this.round(this.avg(split.map((item) => item.goalsAgainst)))
    };
  }

  private normalizeSelection(selection: string) {
    const token = selection.trim().toLowerCase();
    if (["home", "h", "1"].includes(token)) {
      return "home";
    }
    if (["draw", "d", "x"].includes(token)) {
      return "draw";
    }
    if (["away", "a", "2"].includes(token)) {
      return "away";
    }
    if (["yes", "y", "btts_yes", "btts:yes"].includes(token)) {
      return "yes";
    }
    if (["no", "n", "btts_no", "btts:no"].includes(token)) {
      return "no";
    }
    if (["over", "o"].includes(token)) {
      return "over";
    }
    if (["under", "u"].includes(token)) {
      return "under";
    }
    return token;
  }

  private normalizeMarket(market: string) {
    const token = market.trim().toLowerCase();
    if (["matchresult", "match_result", "match_outcome", "moneyline"].includes(token)) {
      return "match_result";
    }
    if (["bothteamstoscore", "btts", "both_teams_to_score"].includes(token)) {
      return "btts";
    }
    if (["totalgoalsoverunder", "over_under", "total", "total_goals_over_under"].includes(token)) {
      return "total_goals";
    }
    return token;
  }

  private resolveLiveMinute(horizon: string) {
    const key = horizon.toUpperCase();
    if (key === "LIVE_0_15") {
      return 8;
    }
    if (key === "LIVE_16_30") {
      return 23;
    }
    if (key === "LIVE_31_45") {
      return 38;
    }
    if (key === "HT") {
      return 45;
    }
    if (key === "LIVE_46_60") {
      return 53;
    }
    if (key === "LIVE_61_75") {
      return 68;
    }
    if (key === "LIVE_76_90") {
      return 83;
    }
    return null;
  }

  private coverageFromFeatures(features: Record<string, unknown>): CoverageFlags {
    const coverage = this.asRecord(features.coverageFlags) ?? {};
    return {
      has_odds: Boolean(coverage.has_odds),
      has_lineup: Boolean(coverage.has_lineup),
      missing_stats_ratio: this.clamp(this.asNumber(coverage.missing_stats_ratio) ?? 1, 0, 1),
      source_rows: Math.max(0, Math.floor(this.asNumber(coverage.source_rows) ?? 0)),
      odds_rows: Math.max(0, Math.floor(this.asNumber(coverage.odds_rows) ?? 0))
    };
  }

  async buildAndPersist(input: BuildFeatureSnapshotInput) {
    const featureCutoffAt = this.normalizeCutoff(input.featureCutoffAt);
    const match = await this.prisma.match.findUnique({
      where: { id: input.matchId },
      select: {
        id: true,
        status: true,
        sport: { select: { code: true } },
        leagueId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeScore: true,
        awayScore: true,
        halfTimeHomeScore: true,
        halfTimeAwayScore: true,
        matchDateTimeUTC: true,
        homeElo: true,
        awayElo: true,
        form5Home: true,
        form5Away: true,
        updatedAt: true
      }
    });

    if (!match) {
      throw new Error(`match_not_found:${input.matchId}`);
    }

    const sportCode = (match.sport.code ?? "").toLowerCase();
    if (sportCode !== "football") {
      throw new Error(`unsupported_sport_for_feature_snapshot:${sportCode || "unknown"}`);
    }

    const [historyMatches, contextSnapshot, sourceRows, oddsRows, sourceRowsAfterCutoff, oddsRowsAfterCutoff] =
      await Promise.all([
      this.prisma.match.findMany({
        where: {
          status: MatchStatus.finished,
          matchDateTimeUTC: { lt: featureCutoffAt },
          updatedAt: { lte: featureCutoffAt },
          OR: [{ homeTeamId: match.homeTeamId }, { awayTeamId: match.homeTeamId }, { homeTeamId: match.awayTeamId }, { awayTeamId: match.awayTeamId }]
        },
        select: {
          id: true,
          matchDateTimeUTC: true,
          homeTeamId: true,
          awayTeamId: true,
          homeScore: true,
          awayScore: true
        },
        orderBy: { matchDateTimeUTC: "desc" },
        take: 120
      }),
      this.prisma.featureSnapshot.findFirst({
        where: {
          matchId: match.id,
          featureSetVersion: "context_enrichment_v1",
          cutoffAt: { lte: featureCutoffAt }
        },
        orderBy: { generatedAt: "desc" },
        select: { featuresJson: true }
      }),
      this.prisma.rawProviderPayload.findMany({
        where: {
          sourceUpdatedAt: { lte: featureCutoffAt },
          entityType: { in: ["fixture", "match", "lineup", "team_stats", "standings", "odds"] },
          providerEntityId: { in: [match.id, match.homeTeamId, match.awayTeamId, match.leagueId] }
        },
        select: { id: true, sourceUpdatedAt: true },
        take: 500
      }),
      this.prisma.oddsSnapshotV2.findMany({
        where: {
          matchId: match.id,
          collectedAt: { lte: featureCutoffAt }
        },
        select: {
          bookmaker: true,
          market: true,
          selection: true,
          line: true,
          normalizedProb: true,
          collectedAt: true
        },
        orderBy: [{ collectedAt: "asc" }]
      }),
      this.prisma.rawProviderPayload.count({
        where: {
          sourceUpdatedAt: { gt: featureCutoffAt },
          entityType: { in: ["fixture", "match", "lineup", "team_stats", "standings", "odds"] },
          providerEntityId: { in: [match.id, match.homeTeamId, match.awayTeamId, match.leagueId] }
        }
      }),
      this.prisma.oddsSnapshotV2.count({
        where: {
          matchId: match.id,
          collectedAt: { gt: featureCutoffAt }
        }
      })
    ]);

    const sourceLeakRows = sourceRows.filter(
      (row) => row.sourceUpdatedAt && row.sourceUpdatedAt.getTime() > featureCutoffAt.getTime()
    ).length;
    const oddsLeakRows = oddsRows.filter((row) => row.collectedAt.getTime() > featureCutoffAt.getTime()).length;
    const leakagePassed = sourceLeakRows === 0 && oddsLeakRows === 0;

    const homePerspective = this.toTeamPerspective(historyMatches, match.homeTeamId);
    const awayPerspective = this.toTeamPerspective(historyMatches, match.awayTeamId);

    const homeLastPlayedAt = homePerspective[0]?.playedAt ?? null;
    const awayLastPlayedAt = awayPerspective[0]?.playedAt ?? null;
    const restDaysHome =
      homeLastPlayedAt === null ? null : this.round((featureCutoffAt.getTime() - homeLastPlayedAt.getTime()) / (24 * 60 * 60 * 1000), 2);
    const restDaysAway =
      awayLastPlayedAt === null ? null : this.round((featureCutoffAt.getTime() - awayLastPlayedAt.getTime()) / (24 * 60 * 60 * 1000), 2);

    const sevenDaysAgo = new Date(featureCutoffAt.getTime() - 7 * 24 * 60 * 60 * 1000);
    const homeCongestion = homePerspective.filter((item) => item.playedAt >= sevenDaysAgo).length;
    const awayCongestion = awayPerspective.filter((item) => item.playedAt >= sevenDaysAgo).length;

    const homeWindow5 = this.formWindow(homePerspective, 5);
    const awayWindow5 = this.formWindow(awayPerspective, 5);
    const homeWindow10 = this.formWindow(homePerspective, 10);
    const awayWindow10 = this.formWindow(awayPerspective, 10);
    const homeWindow3 = this.formWindow(homePerspective, 3);
    const awayWindow3 = this.formWindow(awayPerspective, 3);

    const homeSplit = this.splitSummary(homePerspective, true);
    const awaySplit = this.splitSummary(awayPerspective, false);

    const derivedHomeElo = this.round(1500 + homeWindow10.goalDiffAvg * 35 + homeWindow10.pointsPerGame * 28, 2);
    const derivedAwayElo = this.round(1500 + awayWindow10.goalDiffAvg * 35 + awayWindow10.pointsPerGame * 28, 2);
    const homeElo = match.homeElo ?? derivedHomeElo;
    const awayElo = match.awayElo ?? derivedAwayElo;

    const homeAttackStrength = this.round(this.clamp(homeWindow5.goalsForAvg / 1.35, 0.55, 1.95), 4);
    const awayAttackStrength = this.round(this.clamp(awayWindow5.goalsForAvg / 1.35, 0.55, 1.95), 4);
    const homeDefenseStrength = this.round(this.clamp(1.2 - homeWindow5.goalsAgainstAvg / 2.4, 0.35, 1.35), 4);
    const awayDefenseStrength = this.round(this.clamp(1.2 - awayWindow5.goalsAgainstAvg / 2.4, 0.35, 1.35), 4);

    const contextFeatures = this.asRecord(contextSnapshot?.featuresJson);
    const lineupCertainty = this.asNumber(contextFeatures?.lineupCertaintyScore);
    const lineupCoverage = this.asNumber(contextFeatures?.thesportsdbLineupCoverage);
    const hasLineup = (lineupCertainty !== null && lineupCertainty >= 0.55) || (lineupCoverage !== null && lineupCoverage >= 0.4);

    const historyMatchIds = [...new Set([...homePerspective.map((item) => item.matchId), ...awayPerspective.map((item) => item.matchId)])];
    const recentMatchIds = historyMatchIds.slice(0, 30);
    const teamStatsRows =
      recentMatchIds.length > 0
        ? await this.prisma.teamStat.findMany({
            where: {
              matchId: { in: recentMatchIds },
              teamId: { in: [match.homeTeamId, match.awayTeamId] },
              createdAt: { lte: featureCutoffAt }
            },
            select: { matchId: true, teamId: true }
          })
        : [];

    const expectedStatRows = recentMatchIds.length * 2;
    const actualStatRows = teamStatsRows.length;
    const missingStatsRatio =
      expectedStatRows === 0 ? 1 : this.round(this.clamp(1 - actualStatRows / expectedStatRows, 0, 1), 4);

    const marketOddsRows = oddsRows.filter((row) => this.normalizeMarket(row.market) === "match_result");
    const bySelection = new Map<string, Array<{ normalizedProb: number; collectedAt: Date; bookmaker: string }>>();
    for (const row of marketOddsRows) {
      const selection = this.normalizeSelection(row.selection);
      if (!["home", "draw", "away"].includes(selection)) {
        continue;
      }
      const current = bySelection.get(selection) ?? [];
      current.push({
        normalizedProb: row.normalizedProb,
        collectedAt: row.collectedAt,
        bookmaker: row.bookmaker
      });
      bySelection.set(selection, current);
    }

    const openingOdds: Record<string, number | null> = {};
    const latestOdds: Record<string, number | null> = {};
    const driftOdds: Record<string, number | null> = {};
    const disagreementValues: number[] = [];
    for (const selection of ["home", "draw", "away"]) {
      const rows = (bySelection.get(selection) ?? []).sort(
        (left, right) => left.collectedAt.getTime() - right.collectedAt.getTime()
      );
      const opening = rows[0]?.normalizedProb ?? null;
      const latest = rows[rows.length - 1]?.normalizedProb ?? null;
      openingOdds[selection] = opening === null ? null : this.round(opening, 6);
      latestOdds[selection] = latest === null ? null : this.round(latest, 6);
      driftOdds[selection] =
        opening === null || latest === null ? null : this.round(latest - opening, 6);

      const latestByBookmaker = new Map<string, number>();
      for (const row of rows) {
        latestByBookmaker.set(row.bookmaker, row.normalizedProb);
      }
      const bookmakerValues = [...latestByBookmaker.values()];
      if (bookmakerValues.length >= 2) {
        disagreementValues.push(this.std(bookmakerValues));
      }
    }
    const providerDisagreement = disagreementValues.length > 0 ? this.round(this.avg(disagreementValues), 6) : null;

    const freshnessScore = this.round(
      this.clamp(1 - Math.max(0, Date.now() - featureCutoffAt.getTime()) / (8 * 60 * 60 * 1000), 0, 1),
      4
    );
    const coverageFlags: CoverageFlags = {
      has_odds: oddsRows.length > 0,
      has_lineup: hasLineup,
      missing_stats_ratio: missingStatsRatio,
      source_rows: sourceRows.length,
      odds_rows: oddsRows.length
    };

    const liveMinute = this.resolveLiveMinute(input.horizon);
    const liveState = {
      isLiveHorizon: isLivePredictionHorizon(input.horizon),
      minute: liveMinute,
      homeScore: match.homeScore,
      awayScore: match.awayScore,
      goalDiff:
        typeof match.homeScore === "number" && typeof match.awayScore === "number"
          ? match.homeScore - match.awayScore
          : null
    };

    const features: Record<string, unknown> = {
      horizon: input.horizon,
      cutoffAt: featureCutoffAt.toISOString(),
      featureFamilies: {
        elo_strength: {
          homeElo,
          awayElo,
          eloGap: this.round(homeElo - awayElo, 3),
          homeAttackStrength,
          awayAttackStrength,
          homeDefenseStrength,
          awayDefenseStrength
        },
        recent_form: {
          home: { last3: homeWindow3, last5: homeWindow5, last10: homeWindow10 },
          away: { last3: awayWindow3, last5: awayWindow5, last10: awayWindow10 }
        },
        home_away_splits: {
          homeTeamAtHome: homeSplit,
          awayTeamAway: awaySplit
        },
        schedule: {
          restDaysHome,
          restDaysAway,
          congestionHomeLast7d: homeCongestion,
          congestionAwayLast7d: awayCongestion
        },
        odds: {
          opening: openingOdds,
          current: latestOdds,
          drift: driftOdds,
          providerDisagreement
        },
        live_state: liveState
      },
      context: {
        form5Home: match.form5Home,
        form5Away: match.form5Away,
        halfTimeHomeScore: match.halfTimeHomeScore,
        halfTimeAwayScore: match.halfTimeAwayScore,
        status: match.status,
        matchDateTimeUTC: match.matchDateTimeUTC.toISOString()
      },
      freshnessScore,
      coverageFlags
    };

    try {
      await this.prisma.leakageCheckResult.create({
        data: {
          matchId: match.id,
          horizon: input.horizon,
          cutoffAt: featureCutoffAt,
          sourceLeakRows,
          oddsLeakRows,
          passed: leakagePassed,
          details: {
            sourceRowsAfterCutoff,
            oddsRowsAfterCutoff,
            checkedAt: new Date().toISOString()
          } as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      this.logger.warn(
        `leakage check write skipped for match ${match.id}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }

    const featureHash = this.hashFeatures(features);
    const existing = await this.prisma.featureSnapshot.findFirst({
      where: {
        matchId: match.id,
        horizon: input.horizon,
        featureSetVersion: FEATURE_SET_VERSION,
        cutoffAt: featureCutoffAt,
        featureHash
      },
      select: {
        id: true,
        matchId: true,
        horizon: true,
        featureSetVersion: true,
        cutoffAt: true,
        generatedAt: true,
        featureHash: true,
        featuresJson: true
      }
    });

    if (existing) {
      return {
        ...existing,
        coverage: this.coverageFromFeatures(this.asRecord(existing.featuresJson) ?? features)
      };
    }

    try {
      const created = await this.prisma.featureSnapshot.create({
        data: {
          matchId: match.id,
          horizon: input.horizon,
          featureSetVersion: FEATURE_SET_VERSION,
          cutoffAt: featureCutoffAt,
          featureHash,
          featuresJson: features as Prisma.InputJsonValue
        },
        select: {
          id: true,
          matchId: true,
          horizon: true,
          featureSetVersion: true,
          cutoffAt: true,
          generatedAt: true,
          featureHash: true,
          featuresJson: true
        }
      });

      return {
        ...created,
        coverage: coverageFlags
      };
    } catch (error) {
      this.logger.warn(
        `feature snapshot create fallback for match ${match.id}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      const fallback = await this.prisma.featureSnapshot.findFirst({
        where: {
          matchId: match.id,
          horizon: input.horizon,
          featureSetVersion: FEATURE_SET_VERSION,
          cutoffAt: featureCutoffAt,
          featureHash
        },
        select: {
          id: true,
          matchId: true,
          horizon: true,
          featureSetVersion: true,
          cutoffAt: true,
          generatedAt: true,
          featureHash: true,
          featuresJson: true
        }
      });
      if (!fallback) {
        throw error;
      }
      return {
        ...fallback,
        coverage: this.coverageFromFeatures(this.asRecord(fallback.featuresJson) ?? features)
      };
    }
  }

  async coverageSummary(limit = 2500): Promise<{
    freshness: {
      avgFreshnessScore: number;
      avgCutoffLagMinutes: number;
    };
    horizonCoverage: Array<{ horizon: string; count: number }>;
    coverage: {
      avgMissingStatsRatio: number;
      oddsCoverageRate: number;
      lineupCoverageRate: number;
    };
  }> {
    const rows = await this.prisma.featureSnapshot.findMany({
      where: { featureSetVersion: FEATURE_SET_VERSION },
      orderBy: { generatedAt: "desc" },
      take: limit,
      select: {
        horizon: true,
        cutoffAt: true,
        generatedAt: true,
        featuresJson: true
      }
    });

    if (rows.length === 0) {
      return {
        freshness: {
          avgFreshnessScore: 0,
          avgCutoffLagMinutes: 0
        },
        horizonCoverage: [],
        coverage: {
          avgMissingStatsRatio: 1,
          oddsCoverageRate: 0,
          lineupCoverageRate: 0
        }
      };
    }

    const horizonMap = new Map<string, number>();
    const missingRatios: number[] = [];
    let oddsCount = 0;
    let lineupCount = 0;
    let freshnessTotal = 0;
    let lagMinutesTotal = 0;

    for (const row of rows) {
      horizonMap.set(row.horizon, (horizonMap.get(row.horizon) ?? 0) + 1);
      const features = this.asRecord(row.featuresJson) ?? {};
      const freshnessScore = this.asNumber(features.freshnessScore) ?? 0;
      freshnessTotal += this.clamp(freshnessScore, 0, 1);
      lagMinutesTotal += Math.max(0, (row.generatedAt.getTime() - row.cutoffAt.getTime()) / 60000);

      const coverage = this.coverageFromFeatures(features);
      missingRatios.push(coverage.missing_stats_ratio);
      if (coverage.has_odds) {
        oddsCount += 1;
      }
      if (coverage.has_lineup) {
        lineupCount += 1;
      }
    }

    return {
      freshness: {
        avgFreshnessScore: this.round(freshnessTotal / rows.length, 4),
        avgCutoffLagMinutes: this.round(lagMinutesTotal / rows.length, 2)
      },
      horizonCoverage: [...horizonMap.entries()]
        .map(([horizon, count]) => ({ horizon, count }))
        .sort((left, right) => right.count - left.count),
      coverage: {
        avgMissingStatsRatio: this.round(this.avg(missingRatios), 4),
        oddsCoverageRate: this.round(oddsCount / rows.length, 4),
        lineupCoverageRate: this.round(lineupCount / rows.length, 4)
      }
    };
  }

  coverageFromSnapshotFeatures(featuresJson: unknown): SnapshotCoverageSummary {
    const features = this.asRecord(featuresJson) ?? {};
    const generatedAtRaw = this.asNumber((this.asRecord(features.generatedAt) ?? {}).value);
    const cutoffAtRaw = this.asNumber((this.asRecord(features.cutoffAt) ?? {}).value);
    void generatedAtRaw;
    void cutoffAtRaw;
    return {
      generatedAt: new Date(),
      cutoffAt: new Date(),
      freshnessScore: this.clamp(this.asNumber(features.freshnessScore) ?? 0, 0, 1),
      coverage: this.coverageFromFeatures(features)
    };
  }
}
