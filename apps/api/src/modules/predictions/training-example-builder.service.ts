import { Injectable } from "@nestjs/common";
import { MatchStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

type BuildTrainingExamplesInput = {
  horizons?: string[];
  cutoffAtGte?: Date;
  cutoffAtLte?: Date;
  trainRatio?: number;
  validationRatio?: number;
};

type MarketLabels = {
  fullTimeResult: "home" | "draw" | "away" | null;
  firstHalfResult: "home" | "draw" | "away" | null;
  bothTeamsToScore: "yes" | "no" | null;
  totalGoalsOverUnder: {
    over15: boolean | null;
    over25: boolean | null;
    over35: boolean | null;
  };
  correctScore: string | null;
};

export type TrainingExampleRow = {
  entityKey: string;
  matchId: string;
  horizon: string;
  cutoffAt: Date;
  featureSetVersion: string;
  featureHash: string;
  features: Record<string, unknown>;
  labels: MarketLabels;
  split: "train" | "validation" | "test";
};

@Injectable()
export class TrainingExampleBuilderService {
  constructor(private readonly prisma: PrismaService) {}

  private asRecord(value: unknown) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private outcome(home: number | null, away: number | null): "home" | "draw" | "away" | null {
    if (home === null || away === null) {
      return null;
    }
    if (home > away) {
      return "home";
    }
    if (home < away) {
      return "away";
    }
    return "draw";
  }

  private buildLabels(match: {
    homeScore: number | null;
    awayScore: number | null;
    halfTimeHomeScore: number | null;
    halfTimeAwayScore: number | null;
  }): MarketLabels {
    const totalGoals =
      match.homeScore === null || match.awayScore === null ? null : match.homeScore + match.awayScore;

    return {
      fullTimeResult: this.outcome(match.homeScore, match.awayScore),
      firstHalfResult: this.outcome(match.halfTimeHomeScore, match.halfTimeAwayScore),
      bothTeamsToScore:
        match.homeScore === null || match.awayScore === null
          ? null
          : match.homeScore > 0 && match.awayScore > 0
            ? "yes"
            : "no",
      totalGoalsOverUnder: {
        over15: totalGoals === null ? null : totalGoals > 1.5,
        over25: totalGoals === null ? null : totalGoals > 2.5,
        over35: totalGoals === null ? null : totalGoals > 3.5
      },
      correctScore:
        match.homeScore === null || match.awayScore === null ? null : `${match.homeScore}-${match.awayScore}`
    };
  }

  private hasAtLeastOneLabel(labels: MarketLabels) {
    return (
      labels.fullTimeResult !== null ||
      labels.firstHalfResult !== null ||
      labels.bothTeamsToScore !== null ||
      labels.totalGoalsOverUnder.over15 !== null ||
      labels.correctScore !== null
    );
  }

  private resolveSplit(index: number, total: number, trainRatio: number, validationRatio: number) {
    if (total <= 1) {
      return "train" as const;
    }
    const position = index / total;
    if (position < trainRatio) {
      return "train" as const;
    }
    if (position < trainRatio + validationRatio) {
      return "validation" as const;
    }
    return "test" as const;
  }

  async build(input: BuildTrainingExamplesInput = {}): Promise<{
    rows: TrainingExampleRow[];
    meta: {
      total: number;
      splitCounts: { train: number; validation: number; test: number };
      horizons: Array<{ horizon: string; count: number }>;
    };
  }> {
    const trainRatio = this.clamp(input.trainRatio ?? 0.7, 0.4, 0.9);
    const validationRatio = this.clamp(input.validationRatio ?? 0.15, 0.05, 0.4);
    const whereClause = {
      ...(input.horizons && input.horizons.length > 0 ? { horizon: { in: input.horizons } } : {}),
      ...(input.cutoffAtGte || input.cutoffAtLte
        ? {
            cutoffAt: {
              ...(input.cutoffAtGte ? { gte: input.cutoffAtGte } : {}),
              ...(input.cutoffAtLte ? { lte: input.cutoffAtLte } : {})
            }
          }
        : {})
    };

    const snapshots = await this.prisma.featureSnapshot.findMany({
      where: whereClause,
      orderBy: [{ cutoffAt: "asc" }, { generatedAt: "asc" }],
      include: {
        match: {
          select: {
            id: true,
            status: true,
            matchDateTimeUTC: true,
            homeScore: true,
            awayScore: true,
            halfTimeHomeScore: true,
            halfTimeAwayScore: true
          }
        }
      }
    });

    const usable = snapshots.filter((snapshot) => {
      if (snapshot.match.status !== MatchStatus.finished) {
        return false;
      }
      if (snapshot.cutoffAt.getTime() > snapshot.match.matchDateTimeUTC.getTime() + 6 * 60 * 60 * 1000) {
        return false;
      }
      const labels = this.buildLabels(snapshot.match);
      return this.hasAtLeastOneLabel(labels);
    });

    const rows = usable.map((snapshot, index): TrainingExampleRow => {
      const labels = this.buildLabels(snapshot.match);
      return {
        entityKey: `${snapshot.matchId}:${snapshot.horizon}:${snapshot.cutoffAt.toISOString()}`,
        matchId: snapshot.matchId,
        horizon: snapshot.horizon,
        cutoffAt: snapshot.cutoffAt,
        featureSetVersion: snapshot.featureSetVersion,
        featureHash: snapshot.featureHash,
        features: this.asRecord(snapshot.featuresJson),
        labels,
        split: this.resolveSplit(index, usable.length, trainRatio, validationRatio)
      };
    });

    const splitCounts = rows.reduce(
      (acc, item) => {
        acc[item.split] += 1;
        return acc;
      },
      { train: 0, validation: 0, test: 0 }
    );

    const horizonMap = new Map<string, number>();
    for (const row of rows) {
      horizonMap.set(row.horizon, (horizonMap.get(row.horizon) ?? 0) + 1);
    }

    return {
      rows,
      meta: {
        total: rows.length,
        splitCounts,
        horizons: [...horizonMap.entries()]
          .map(([horizon, count]) => ({ horizon, count }))
          .sort((left, right) => right.count - left.count)
      }
    };
  }
}
