import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";

type BuildLineupSnapshotInput = {
  matchId: string;
  horizon: string;
  cutoffAt: Date;
};

type TeamLineupMetrics = {
  teamId: string;
  teamName: string;
  providerKey: string | null;
  formation: string | null;
  starters: number;
  availableStarters: number;
  missingStarters: number;
  benchCount: number;
  availableBench: number;
  startingXiStrength: number;
  benchStrength: number;
  goalkeeperChangeFlag: boolean;
  defenseStrength: number;
  midfieldStrength: number;
  attackStrength: number;
};

@Injectable()
export class LineupSnapshotService {
  private readonly logger = new Logger(LineupSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizeCutoff(value: Date) {
    return new Date(Math.floor(value.getTime() / 1000) * 1000);
  }

  private round(value: number, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
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

  private hashPayload(value: unknown) {
    return createHash("sha256").update(this.stableStringify(value)).digest("hex");
  }

  private bucketFromPosition(position: string | null): "gk" | "def" | "mid" | "att" | "other" {
    const token = (position ?? "").trim().toLowerCase();
    if (!token) {
      return "other";
    }
    if (token.includes("gk") || token.includes("goalkeeper") || token.includes("kaleci")) {
      return "gk";
    }
    if (
      token.includes("def") ||
      token.includes("back") ||
      token.includes("centre-back") ||
      token.includes("center-back") ||
      token.includes("stoper")
    ) {
      return "def";
    }
    if (token.includes("mid") || token.includes("wing") || token.includes("kanat")) {
      return "mid";
    }
    if (token.includes("att") || token.includes("for") || token.includes("striker") || token.includes("forward")) {
      return "att";
    }
    return "other";
  }

  private isUnavailable(status: string) {
    return status === "OUT" || status === "SUSPENDED" || status === "INJURY_UNKNOWN";
  }

  private toTeamMetrics(lineup: {
    teamId: string;
    team: { name: string };
    providerKey: string | null;
    formation: string | null;
    players: Array<{
      playerName: string;
      position: string | null;
      isStarter: boolean;
      availability: string;
      sortOrder: number | null;
    }>;
  } | null): TeamLineupMetrics {
    if (!lineup) {
      return {
        teamId: "unknown",
        teamName: "Unknown",
        providerKey: null,
        formation: null,
        starters: 0,
        availableStarters: 0,
        missingStarters: 0,
        benchCount: 0,
        availableBench: 0,
        startingXiStrength: 0,
        benchStrength: 0,
        goalkeeperChangeFlag: false,
        defenseStrength: 0,
        midfieldStrength: 0,
        attackStrength: 0
      };
    }

    const starters = lineup.players.filter((item) => item.isStarter);
    const bench = lineup.players.filter((item) => !item.isStarter);
    const availableStarters = starters.filter((item) => !this.isUnavailable(item.availability)).length;
    const availableBench = bench.filter((item) => !this.isUnavailable(item.availability)).length;
    const missingStarters = Math.max(0, starters.length - availableStarters);

    const starterByBucket = {
      gk: starters.filter((item) => this.bucketFromPosition(item.position) === "gk"),
      def: starters.filter((item) => this.bucketFromPosition(item.position) === "def"),
      mid: starters.filter((item) => this.bucketFromPosition(item.position) === "mid"),
      att: starters.filter((item) => this.bucketFromPosition(item.position) === "att")
    };

    const availableByBucket = {
      gk: starterByBucket.gk.filter((item) => !this.isUnavailable(item.availability)).length,
      def: starterByBucket.def.filter((item) => !this.isUnavailable(item.availability)).length,
      mid: starterByBucket.mid.filter((item) => !this.isUnavailable(item.availability)).length,
      att: starterByBucket.att.filter((item) => !this.isUnavailable(item.availability)).length
    };

    const goalkeeperChangeFlag = starterByBucket.gk.length > 0 && availableByBucket.gk === 0;

    const defenseStrength = this.round(availableByBucket.def / Math.max(1, starterByBucket.def.length || 4), 4);
    const midfieldStrength = this.round(availableByBucket.mid / Math.max(1, starterByBucket.mid.length || 3), 4);
    const attackStrength = this.round(availableByBucket.att / Math.max(1, starterByBucket.att.length || 3), 4);

    return {
      teamId: lineup.teamId,
      teamName: lineup.team.name,
      providerKey: lineup.providerKey,
      formation: lineup.formation,
      starters: starters.length,
      availableStarters,
      missingStarters,
      benchCount: bench.length,
      availableBench,
      startingXiStrength: this.round(availableStarters / Math.max(11, starters.length || 11), 4),
      benchStrength: this.round(availableBench / Math.max(7, bench.length || 7), 4),
      goalkeeperChangeFlag,
      defenseStrength,
      midfieldStrength,
      attackStrength
    };
  }

  async buildAndPersist(input: BuildLineupSnapshotInput) {
    const cutoffAt = this.normalizeCutoff(input.cutoffAt);
    const match = await this.prisma.match.findUnique({
      where: { id: input.matchId },
      select: {
        id: true,
        leagueId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeTeam: { select: { id: true, name: true } },
        awayTeam: { select: { id: true, name: true } }
      }
    });

    if (!match) {
      throw new Error(`lineup_snapshot_match_not_found:${input.matchId}`);
    }

    const rows = await this.prisma.canonicalLineup.findMany({
      where: {
        matchId: match.id,
        pulledAt: { lte: cutoffAt },
        OR: [{ sourceUpdatedAt: { lte: cutoffAt } }, { sourceUpdatedAt: null }]
      },
      orderBy: [{ sourceUpdatedAt: "desc" }, { pulledAt: "desc" }, { createdAt: "desc" }],
      include: {
        team: {
          select: { id: true, name: true }
        },
        players: {
          select: {
            playerName: true,
            position: true,
            isStarter: true,
            availability: true,
            sortOrder: true
          },
          orderBy: [{ isStarter: "desc" }, { sortOrder: "asc" }, { playerName: "asc" }]
        }
      },
      take: 120
    });

    const byTeam = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!byTeam.has(row.teamId)) {
        byTeam.set(row.teamId, row);
      }
    }

    const homeLineup = byTeam.get(match.homeTeamId) ?? null;
    const awayLineup = byTeam.get(match.awayTeamId) ?? null;

    const homeMetrics = this.toTeamMetrics(homeLineup);
    const awayMetrics = this.toTeamMetrics(awayLineup);

    const deltas = {
      starting_xi_strength: this.round(homeMetrics.startingXiStrength - awayMetrics.startingXiStrength, 4),
      bench_strength: this.round(homeMetrics.benchStrength - awayMetrics.benchStrength, 4),
      missing_starters_count: homeMetrics.missingStarters - awayMetrics.missingStarters,
      goalkeeper_change_flag: homeMetrics.goalkeeperChangeFlag || awayMetrics.goalkeeperChangeFlag ? 1 : 0,
      defense_strength_delta: this.round(homeMetrics.defenseStrength - awayMetrics.defenseStrength, 4),
      midfield_strength_delta: this.round(homeMetrics.midfieldStrength - awayMetrics.midfieldStrength, 4),
      attack_strength_delta: this.round(homeMetrics.attackStrength - awayMetrics.attackStrength, 4)
    };

    const latestSourceTimestamp = rows.reduce<Date | null>((latest, row) => {
      const current = row.sourceUpdatedAt ?? row.pulledAt;
      if (!latest) {
        return current;
      }
      return current.getTime() > latest.getTime() ? current : latest;
    }, null);

    const recencyMinutes =
      latestSourceTimestamp === null
        ? null
        : this.round(Math.max(0, (cutoffAt.getTime() - latestSourceTimestamp.getTime()) / 60000), 2);

    const lineupJson = {
      cutoffAt: cutoffAt.toISOString(),
      home: homeLineup
        ? {
            teamId: homeMetrics.teamId,
            teamName: homeMetrics.teamName,
            providerKey: homeMetrics.providerKey,
            formation: homeMetrics.formation,
            metrics: homeMetrics
          }
        : null,
      away: awayLineup
        ? {
            teamId: awayMetrics.teamId,
            teamName: awayMetrics.teamName,
            providerKey: awayMetrics.providerKey,
            formation: awayMetrics.formation,
            metrics: awayMetrics
          }
        : null,
      deltas
    };

    const coverageJson = {
      has_lineup: Boolean(homeLineup || awayLineup),
      has_home_lineup: Boolean(homeLineup),
      has_away_lineup: Boolean(awayLineup),
      teams_covered: Number(Boolean(homeLineup)) + Number(Boolean(awayLineup)),
      total_lineup_rows: rows.length,
      provider_count: new Set(rows.map((row) => row.providerKey ?? "unknown")).size,
      source_recency_minutes: recencyMinutes
    };

    const lineupHash = this.hashPayload({ lineupJson, coverageJson });
    const existing = await this.prisma.lineupSnapshot.findFirst({
      where: {
        matchId: match.id,
        horizon: input.horizon,
        cutoffAt,
        lineupHash
      }
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.lineupSnapshot.create({
        data: {
          matchId: match.id,
          horizon: input.horizon,
          cutoffAt,
          lineupHash,
          lineupJson: lineupJson as Prisma.InputJsonValue,
          coverageJson: coverageJson as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      this.logger.warn(
        `lineup snapshot create fallback for ${match.id}/${input.horizon}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      const fallback = await this.prisma.lineupSnapshot.findFirst({
        where: {
          matchId: match.id,
          horizon: input.horizon,
          cutoffAt,
          lineupHash
        }
      });
      if (!fallback) {
        throw error;
      }
      return fallback;
    }
  }

  scoreLineupSignal(lineupJson: unknown) {
    if (!lineupJson || typeof lineupJson !== "object" || Array.isArray(lineupJson)) {
      return 0;
    }
    const record = lineupJson as Record<string, unknown>;
    const deltas = record.deltas && typeof record.deltas === "object" ? (record.deltas as Record<string, unknown>) : {};
    const startingEdge = Number(deltas.starting_xi_strength ?? 0);
    const benchEdge = Number(deltas.bench_strength ?? 0);
    const defenseEdge = Number(deltas.defense_strength_delta ?? 0);
    const midfieldEdge = Number(deltas.midfield_strength_delta ?? 0);
    const attackEdge = Number(deltas.attack_strength_delta ?? 0);
    const keeperFlag = Number(deltas.goalkeeper_change_flag ?? 0);
    const raw =
      startingEdge * 0.55 +
      benchEdge * 0.2 +
      defenseEdge * 0.1 +
      midfieldEdge * 0.08 +
      attackEdge * 0.12 -
      keeperFlag * 0.05;
    return this.round(this.clamp(raw, -0.25, 0.25), 6);
  }
}

