import { Injectable } from "@nestjs/common";
import { MatchStatus, Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelAliasService } from "./model-alias.service";

export type BuildTrainingDatasetInput = {
  sport: string;
  market: string;
  line?: number | null;
  horizon: string;
  leagueId?: string | null;
  featureSetVersion?: string | null;
  windowStart: Date;
  windowEnd: Date;
};

@Injectable()
export class TrainingDatasetBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelAliasService: ModelAliasService
  ) {}

  private lineKey(line: number | null | undefined) {
    return this.modelAliasService.lineKey(line);
  }

  private normalizeWindow(value: Date) {
    return new Date(Math.floor(value.getTime() / 1000) * 1000);
  }

  private buildDatasetHash(parts: string[]) {
    const hash = createHash("sha256");
    hash.update(parts.join("|"));
    return hash.digest("hex");
  }

  async build(input: BuildTrainingDatasetInput) {
    const sport = input.sport.trim().toLowerCase();
    const market = input.market.trim().toLowerCase();
    const horizon = input.horizon.trim().toUpperCase();
    const line = input.line ?? null;
    const lineKey = this.lineKey(line);
    const scopeLeagueKey = this.modelAliasService.scopeLeagueKey(input.leagueId ?? null);
    const windowStart = this.normalizeWindow(input.windowStart);
    const windowEnd = this.normalizeWindow(input.windowEnd);

    const snapshots = await this.prisma.featureSnapshot.findMany({
      where: {
        horizon,
        cutoffAt: { gte: windowStart, lte: windowEnd },
        match: {
          status: MatchStatus.finished,
          sport: {
            code: sport
          },
          ...(input.leagueId ? { leagueId: input.leagueId } : {})
        },
        ...(input.featureSetVersion ? { featureSetVersion: input.featureSetVersion } : {})
      },
      select: {
        id: true,
        matchId: true,
        horizon: true,
        cutoffAt: true,
        featureSetVersion: true,
        match: {
          select: {
            homeScore: true,
            awayScore: true,
            status: true,
            matchDateTimeUTC: true
          }
        }
      },
      orderBy: [{ cutoffAt: "asc" }, { id: "asc" }]
    });

    const datasetHash = this.buildDatasetHash([
      sport,
      market,
      lineKey,
      horizon,
      scopeLeagueKey,
      windowStart.toISOString(),
      windowEnd.toISOString(),
      String(snapshots.length),
      ...snapshots.map((item) => item.id)
    ]);

    const featureSetVersion = input.featureSetVersion ?? snapshots[0]?.featureSetVersion ?? null;
    const leakageRows = snapshots.filter((item) => item.cutoffAt.getTime() > item.match.matchDateTimeUTC.getTime()).length;

    const dataset = await this.prisma.trainingDataset.upsert({
      where: { datasetHash },
      update: {
        sampleSize: snapshots.length,
        featureSetVersion,
        inclusionBoundaries: {
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          snapshotCount: snapshots.length
        } as Prisma.InputJsonValue,
        leakageChecks: {
          cutoffAfterMatchCount: leakageRows
        } as Prisma.InputJsonValue
      },
      create: {
        sportCode: sport,
        market,
        line,
        lineKey,
        horizon,
        leagueId: input.leagueId ?? null,
        scopeLeagueKey,
        featureSetVersion,
        windowStart,
        windowEnd,
        sampleSize: snapshots.length,
        datasetHash,
        inclusionBoundaries: {
          windowStart: windowStart.toISOString(),
          windowEnd: windowEnd.toISOString(),
          snapshotCount: snapshots.length
        } as Prisma.InputJsonValue,
        leakageChecks: {
          cutoffAfterMatchCount: leakageRows
        } as Prisma.InputJsonValue
      }
    });

    if (snapshots.length > 0) {
      await this.prisma.datasetSnapshot.createMany({
        data: snapshots.map((item) => ({
          trainingDatasetId: dataset.id,
          matchId: item.matchId,
          horizon: item.horizon,
          cutoffAt: item.cutoffAt,
          featureSnapshotId: item.id,
          labelJson: {
            homeScore: item.match.homeScore,
            awayScore: item.match.awayScore,
            status: item.match.status
          } as Prisma.InputJsonValue
        })),
        skipDuplicates: true
      });
    }

    return {
      datasetId: dataset.id,
      datasetHash,
      sampleSize: snapshots.length,
      leakageRows
    };
  }
}
