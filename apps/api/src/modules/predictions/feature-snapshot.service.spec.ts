import { MatchStatus } from "@prisma/client";
import { FeatureSnapshotService } from "./feature-snapshot.service";

function createBasePrismaStub() {
  const cutoff = new Date("2026-04-17T12:00:00.000Z");
  const createdRow = {
    id: "snapshot-created",
    matchId: "match-1",
    horizon: "PRE24",
    featureSetVersion: "football_feature_snapshot_v1",
    cutoffAt: cutoff,
    generatedAt: new Date("2026-04-17T12:00:01.000Z"),
    featureHash: "hash-created",
    featuresJson: {
      freshnessScore: 0.9,
      coverageFlags: {
        has_odds: true,
        has_lineup: false,
        missing_stats_ratio: 0.2,
        source_rows: 3,
        odds_rows: 4
      }
    }
  };

  const featureFindFirst = jest
    .fn()
    .mockResolvedValueOnce(null) // context snapshot
    .mockResolvedValueOnce(null); // existing snapshot

  const prisma = {
    match: {
      findUnique: jest.fn().mockResolvedValue({
        id: "match-1",
        status: MatchStatus.scheduled,
        sport: { code: "football" },
        leagueId: "league-1",
        homeTeamId: "home-1",
        awayTeamId: "away-1",
        homeScore: null,
        awayScore: null,
        halfTimeHomeScore: null,
        halfTimeAwayScore: null,
        matchDateTimeUTC: new Date("2026-04-18T18:00:00.000Z"),
        homeElo: 1605,
        awayElo: 1540,
        form5Home: 1.2,
        form5Away: 0.9,
        updatedAt: cutoff
      }),
      findMany: jest.fn().mockResolvedValue([
        {
          id: "hist-1",
          matchDateTimeUTC: new Date("2026-04-12T18:00:00.000Z"),
          homeTeamId: "home-1",
          awayTeamId: "opp-1",
          homeScore: 2,
          awayScore: 1
        },
        {
          id: "hist-2",
          matchDateTimeUTC: new Date("2026-04-10T18:00:00.000Z"),
          homeTeamId: "opp-2",
          awayTeamId: "away-1",
          homeScore: 1,
          awayScore: 1
        }
      ])
    },
    featureSnapshot: {
      findFirst: featureFindFirst,
      create: jest.fn().mockResolvedValue(createdRow)
    },
    rawProviderPayload: {
      findMany: jest.fn().mockResolvedValue([{ id: "raw-1" }]),
      count: jest.fn().mockResolvedValue(0)
    },
    oddsSnapshotV2: {
      findMany: jest.fn().mockResolvedValue([
        {
          bookmaker: "bk-1",
          market: "match_outcome",
          selection: "home",
          line: null,
          normalizedProb: 0.54,
          collectedAt: new Date("2026-04-17T10:00:00.000Z")
        }
      ]),
      count: jest.fn().mockResolvedValue(0)
    },
    teamStat: {
      findMany: jest.fn().mockResolvedValue([
        { matchId: "hist-1", teamId: "home-1" },
        { matchId: "hist-2", teamId: "away-1" }
      ])
    },
    leakageCheckResult: {
      create: jest.fn().mockResolvedValue({ id: "leakage-1" })
    }
  };

  return { prisma, cutoff, createdRow };
}

describe("FeatureSnapshotService", () => {
  it("uses point-in-time filters and blocks future leakage in source/odds queries", async () => {
    const { prisma, cutoff } = createBasePrismaStub();
    const service = new FeatureSnapshotService(prisma as any);

    await service.buildAndPersist({
      matchId: "match-1",
      horizon: "PRE24",
      featureCutoffAt: cutoff
    });

    expect(prisma.rawProviderPayload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceUpdatedAt: { lte: cutoff }
        })
      })
    );
    expect(prisma.oddsSnapshotV2.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          collectedAt: { lte: cutoff }
        })
      })
    );
    expect(prisma.rawProviderPayload.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          sourceUpdatedAt: { gt: cutoff }
        })
      })
    );
    expect(prisma.oddsSnapshotV2.count).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          collectedAt: { gt: cutoff }
        })
      })
    );
  });

  it("same cutoff_at produces deterministic feature_hash", async () => {
    const { prisma, cutoff } = createBasePrismaStub();
    (prisma.featureSnapshot.create as jest.Mock)
      .mockResolvedValueOnce({
        id: "snapshot-1",
        matchId: "match-1",
        horizon: "PRE24",
        featureSetVersion: "football_feature_snapshot_v1",
        cutoffAt: cutoff,
        generatedAt: new Date("2026-04-17T12:00:01.000Z"),
        featureHash: "first-hash",
        featuresJson: {}
      })
      .mockResolvedValueOnce({
        id: "snapshot-2",
        matchId: "match-1",
        horizon: "PRE24",
        featureSetVersion: "football_feature_snapshot_v1",
        cutoffAt: cutoff,
        generatedAt: new Date("2026-04-17T12:00:02.000Z"),
        featureHash: "second-hash",
        featuresJson: {}
      });
    (prisma.featureSnapshot.findFirst as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);

    const service = new FeatureSnapshotService(prisma as any);
    await service.buildAndPersist({
      matchId: "match-1",
      horizon: "PRE24",
      featureCutoffAt: cutoff
    });
    await service.buildAndPersist({
      matchId: "match-1",
      horizon: "PRE24",
      featureCutoffAt: cutoff
    });

    const firstCreateArg = (prisma.featureSnapshot.create as jest.Mock).mock.calls[0][0];
    const secondCreateArg = (prisma.featureSnapshot.create as jest.Mock).mock.calls[1][0];
    expect(firstCreateArg.data.featureHash).toBe(secondCreateArg.data.featureHash);
  });

  it("rerun is idempotent when identical snapshot already exists", async () => {
    const { prisma, cutoff, createdRow } = createBasePrismaStub();
    const existingRow = {
      ...createdRow,
      id: "snapshot-existing"
    };
    (prisma.featureSnapshot.findFirst as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(existingRow);

    const service = new FeatureSnapshotService(prisma as any);
    const first = await service.buildAndPersist({
      matchId: "match-1",
      horizon: "PRE24",
      featureCutoffAt: cutoff
    });
    const second = await service.buildAndPersist({
      matchId: "match-1",
      horizon: "PRE24",
      featureCutoffAt: cutoff
    });

    expect(first.id).toBe("snapshot-created");
    expect(second.id).toBe("snapshot-existing");
    expect((prisma.featureSnapshot.create as jest.Mock).mock.calls).toHaveLength(1);
  });
});
