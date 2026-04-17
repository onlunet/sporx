import { Injectable, Logger } from "@nestjs/common";
import { MatchStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";

type BuildEventAggregateInput = {
  matchId: string;
  horizon: string;
  cutoffAt: Date;
};

type TeamEventFeatures = {
  sampleSize: number;
  shots_for: number;
  shots_against: number;
  xg_for: number;
  xg_against: number;
  big_chances_for: number;
  big_chances_against: number;
  set_piece_threat: number;
  transition_threat: number;
  red_card_rate: number;
  pressing_proxy: number;
  field_tilt_proxy: number;
};

@Injectable()
export class EventEnrichmentService {
  private readonly logger = new Logger(EventEnrichmentService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizeCutoff(value: Date) {
    return new Date(Math.floor(value.getTime() / 1000) * 1000);
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private avg(values: number[]) {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private round(value: number, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
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

  private hashPayload(payload: unknown) {
    return createHash("sha256").update(this.stableStringify(payload)).digest("hex");
  }

  private toEventTypeToken(value: string) {
    return value.trim().toLowerCase().replace(/\s+/g, "_");
  }

  private isBigChanceToken(token: string) {
    return token.includes("big_chance") || token.includes("clear_chance");
  }

  private isSetPieceToken(token: string) {
    return token.includes("set_piece") || token.includes("corner") || token.includes("free_kick");
  }

  private isTransitionToken(token: string) {
    return token.includes("transition") || token.includes("counter");
  }

  private isRedCardToken(token: string) {
    return token === "red_card" || token.includes("second_yellow");
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

  private emptyFeatures(): TeamEventFeatures {
    return {
      sampleSize: 0,
      shots_for: 0,
      shots_against: 0,
      xg_for: 0,
      xg_against: 0,
      big_chances_for: 0,
      big_chances_against: 0,
      set_piece_threat: 0,
      transition_threat: 0,
      red_card_rate: 0,
      pressing_proxy: 0,
      field_tilt_proxy: 0
    };
  }

  async buildAndPersist(input: BuildEventAggregateInput) {
    const cutoffAt = this.normalizeCutoff(input.cutoffAt);
    const match = await this.prisma.match.findUnique({
      where: { id: input.matchId },
      select: {
        id: true,
        leagueId: true,
        homeTeamId: true,
        awayTeamId: true
      }
    });
    if (!match) {
      throw new Error(`event_enrichment_match_not_found:${input.matchId}`);
    }

    const history = await this.prisma.match.findMany({
      where: {
        status: MatchStatus.finished,
        matchDateTimeUTC: { lt: cutoffAt },
        updatedAt: { lte: cutoffAt },
        OR: [
          { homeTeamId: match.homeTeamId },
          { awayTeamId: match.homeTeamId },
          { homeTeamId: match.awayTeamId },
          { awayTeamId: match.awayTeamId }
        ]
      },
      select: {
        id: true,
        homeTeamId: true,
        awayTeamId: true,
        matchDateTimeUTC: true
      },
      orderBy: [{ matchDateTimeUTC: "desc" }],
      take: 160
    });

    const historyByTeam = (teamId: string) =>
      history.filter((row) => row.homeTeamId === teamId || row.awayTeamId === teamId).slice(0, 30);

    const homeHistory = historyByTeam(match.homeTeamId);
    const awayHistory = historyByTeam(match.awayTeamId);
    const allMatchIds = [...new Set([...homeHistory.map((row) => row.id), ...awayHistory.map((row) => row.id)])];

    const [statsRows, eventRows] = await Promise.all([
      allMatchIds.length === 0
        ? Promise.resolve([])
        : this.prisma.teamStat.findMany({
            where: {
              matchId: { in: allMatchIds },
              createdAt: { lte: cutoffAt }
            },
            select: {
              matchId: true,
              teamId: true,
              shots: true,
              shotsOnTarget: true,
              corners: true,
              redCards: true,
              possession: true,
              fouls: true,
              transitionScore: true,
              setPieceScore: true,
              offenseScore: true,
              defenseScore: true
            }
          }),
      allMatchIds.length === 0
        ? Promise.resolve([])
        : this.prisma.matchEvent.findMany({
            where: {
              matchId: { in: allMatchIds },
              createdAt: { lte: cutoffAt }
            },
            select: {
              matchId: true,
              teamId: true,
              eventType: true
            }
          })
    ]);

    const statsByMatchTeam = new Map<string, (typeof statsRows)[number]>();
    for (const row of statsRows) {
      statsByMatchTeam.set(`${row.matchId}|${row.teamId}`, row);
    }

    const eventsByMatchTeam = new Map<string, string[]>();
    for (const row of eventRows) {
      if (!row.teamId) {
        continue;
      }
      const key = `${row.matchId}|${row.teamId}`;
      const current = eventsByMatchTeam.get(key) ?? [];
      current.push(this.toEventTypeToken(row.eventType));
      eventsByMatchTeam.set(key, current);
    }

    const computeTeam = (teamId: string, rows: typeof homeHistory): TeamEventFeatures => {
      if (rows.length === 0) {
        return this.emptyFeatures();
      }

      const shotsFor: number[] = [];
      const shotsAgainst: number[] = [];
      const xgFor: number[] = [];
      const xgAgainst: number[] = [];
      const bigChanceFor: number[] = [];
      const bigChanceAgainst: number[] = [];
      const setPieceThreat: number[] = [];
      const transitionThreat: number[] = [];
      const redCardHits: number[] = [];
      const pressingProxy: number[] = [];
      const fieldTiltProxy: number[] = [];

      for (const historyMatch of rows) {
        const opponentId =
          historyMatch.homeTeamId === teamId ? historyMatch.awayTeamId : historyMatch.homeTeamId;
        const ownStat = statsByMatchTeam.get(`${historyMatch.id}|${teamId}`);
        const oppStat = statsByMatchTeam.get(`${historyMatch.id}|${opponentId}`);
        const ownEvents = eventsByMatchTeam.get(`${historyMatch.id}|${teamId}`) ?? [];
        const oppEvents = eventsByMatchTeam.get(`${historyMatch.id}|${opponentId}`) ?? [];

        const ownShots = ownStat?.shots ?? 0;
        const oppShots = oppStat?.shots ?? 0;
        const ownOnTarget = ownStat?.shotsOnTarget ?? 0;
        const oppOnTarget = oppStat?.shotsOnTarget ?? 0;
        const ownCorners = ownStat?.corners ?? 0;
        const oppCorners = oppStat?.corners ?? 0;

        shotsFor.push(ownShots);
        shotsAgainst.push(oppShots);

        const ownXg = ownOnTarget * 0.14 + ownShots * 0.04 + ownCorners * 0.015 + (ownStat?.offenseScore ?? 0) * 0.12;
        const oppXg = oppOnTarget * 0.14 + oppShots * 0.04 + oppCorners * 0.015 + (oppStat?.offenseScore ?? 0) * 0.12;
        xgFor.push(ownXg);
        xgAgainst.push(oppXg);

        bigChanceFor.push(ownEvents.filter((token) => this.isBigChanceToken(token)).length + ownOnTarget * 0.2);
        bigChanceAgainst.push(oppEvents.filter((token) => this.isBigChanceToken(token)).length + oppOnTarget * 0.2);

        setPieceThreat.push(
          ownEvents.filter((token) => this.isSetPieceToken(token)).length * 0.6 +
            ownCorners * 0.25 +
            (ownStat?.setPieceScore ?? 0) * 0.35
        );
        transitionThreat.push(
          ownEvents.filter((token) => this.isTransitionToken(token)).length * 0.6 +
            (ownStat?.transitionScore ?? 0) * 0.4 +
            (ownStat?.offenseScore ?? 0) * 0.08
        );
        redCardHits.push(
          (ownStat?.redCards ?? 0) > 0 || ownEvents.some((token) => this.isRedCardToken(token)) ? 1 : 0
        );
        pressingProxy.push(
          this.clamp((ownStat?.fouls ?? 0) * 0.05 + (ownStat?.defenseScore ?? 0) * 0.18, 0, 5)
        );
        fieldTiltProxy.push(this.clamp((ownStat?.possession ?? 50) / 100, 0, 1));
      }

      return {
        sampleSize: rows.length,
        shots_for: this.round(this.avg(shotsFor), 4),
        shots_against: this.round(this.avg(shotsAgainst), 4),
        xg_for: this.round(this.avg(xgFor), 4),
        xg_against: this.round(this.avg(xgAgainst), 4),
        big_chances_for: this.round(this.avg(bigChanceFor), 4),
        big_chances_against: this.round(this.avg(bigChanceAgainst), 4),
        set_piece_threat: this.round(this.avg(setPieceThreat), 4),
        transition_threat: this.round(this.avg(transitionThreat), 4),
        red_card_rate: this.round(this.avg(redCardHits), 4),
        pressing_proxy: this.round(this.avg(pressingProxy), 4),
        field_tilt_proxy: this.round(this.avg(fieldTiltProxy), 4)
      };
    };

    const home = computeTeam(match.homeTeamId, homeHistory);
    const away = computeTeam(match.awayTeamId, awayHistory);

    const aggregateJson = {
      cutoffAt: cutoffAt.toISOString(),
      home,
      away,
      deltas: {
        shots_for_delta: this.round(home.shots_for - away.shots_for, 4),
        shots_against_delta: this.round(home.shots_against - away.shots_against, 4),
        xg_for_delta: this.round(home.xg_for - away.xg_for, 4),
        xg_against_delta: this.round(home.xg_against - away.xg_against, 4),
        big_chances_delta: this.round(home.big_chances_for - away.big_chances_for, 4),
        set_piece_threat_delta: this.round(home.set_piece_threat - away.set_piece_threat, 4),
        transition_threat_delta: this.round(home.transition_threat - away.transition_threat, 4),
        red_card_rate_delta: this.round(home.red_card_rate - away.red_card_rate, 4),
        field_tilt_delta: this.round(home.field_tilt_proxy - away.field_tilt_proxy, 4)
      }
    };

    const expectedStatRows = Math.max(1, allMatchIds.length * 2);
    const actualStatRows = statsRows.length;
    const coverageJson = {
      has_event_data: eventRows.length > 0,
      has_team_stats: actualStatRows > 0,
      sample_home: home.sampleSize,
      sample_away: away.sampleSize,
      stats_coverage_ratio: this.round(this.clamp(actualStatRows / expectedStatRows, 0, 1), 4),
      event_rows: eventRows.length,
      stat_rows: statsRows.length
    };

    const aggregateHash = this.hashPayload({ aggregateJson, coverageJson });
    const existing = await this.prisma.eventAggregateSnapshot.findFirst({
      where: {
        matchId: match.id,
        horizon: input.horizon,
        cutoffAt,
        aggregateHash
      }
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.eventAggregateSnapshot.create({
        data: {
          matchId: match.id,
          horizon: input.horizon,
          cutoffAt,
          aggregateHash,
          aggregateJson: aggregateJson as Prisma.InputJsonValue,
          coverageJson: coverageJson as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      this.logger.warn(
        `event aggregate snapshot create fallback for ${match.id}/${input.horizon}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      const fallback = await this.prisma.eventAggregateSnapshot.findFirst({
        where: {
          matchId: match.id,
          horizon: input.horizon,
          cutoffAt,
          aggregateHash
        }
      });
      if (!fallback) {
        throw error;
      }
      return fallback;
    }
  }

  scoreEventSignal(aggregateJson: unknown) {
    if (!aggregateJson || typeof aggregateJson !== "object" || Array.isArray(aggregateJson)) {
      return 0;
    }
    const record = aggregateJson as Record<string, unknown>;
    const deltas = record.deltas && typeof record.deltas === "object" ? (record.deltas as Record<string, unknown>) : {};
    const xgFor = this.asNumber(deltas.xg_for_delta) ?? 0;
    const xgAgainst = this.asNumber(deltas.xg_against_delta) ?? 0;
    const shotsFor = this.asNumber(deltas.shots_for_delta) ?? 0;
    const setPiece = this.asNumber(deltas.set_piece_threat_delta) ?? 0;
    const transition = this.asNumber(deltas.transition_threat_delta) ?? 0;
    const redCardDelta = this.asNumber(deltas.red_card_rate_delta) ?? 0;
    const raw =
      xgFor * 0.11 -
      xgAgainst * 0.09 +
      shotsFor * 0.02 +
      setPiece * 0.02 +
      transition * 0.03 -
      redCardDelta * 0.08;
    return this.round(this.clamp(raw, -0.3, 0.3), 6);
  }
}

