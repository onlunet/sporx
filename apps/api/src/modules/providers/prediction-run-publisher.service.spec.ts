import { MatchStatus } from "@prisma/client";
import { PredictionRunPublisherService } from "./prediction-run-publisher.service";

type InMemoryPublishedRow = {
  matchId: string;
  market: string;
  lineKey: string;
  horizon: string;
  predictionRunId: string;
};

function createPrismaStub(options?: { failFirstTransactionWithP2034?: boolean; failFirstUpsert?: boolean }) {
  let runSequence = 0;
  let transactionAttempts = 0;
  let upsertAttempts = 0;
  const runs: Array<{ id: string; matchId: string }> = [];
  const publishedByKey = new Map<string, InMemoryPublishedRow>();

  const tx = {
    $queryRaw: jest.fn().mockResolvedValue([{ pg_advisory_xact_lock: true }]),
    featureSnapshot: {
      findUnique: jest.fn().mockResolvedValue(null),
      findFirst: jest.fn().mockResolvedValue(null)
    },
    oddsSnapshotV2: {
      findFirst: jest.fn().mockResolvedValue(null)
    },
    predictionRun: {
      create: jest.fn().mockImplementation(async ({ data }: { data: { matchId: string } }) => {
        runSequence += 1;
        const created = {
          id: `run-${runSequence}`,
          matchId: data.matchId
        };
        runs.push(created);
        return created;
      })
    },
    publishedPrediction: {
      upsert: jest.fn().mockImplementation(async ({ where, update, create }: any) => {
        upsertAttempts += 1;
        if (options?.failFirstUpsert && upsertAttempts === 1) {
          throw new Error("simulated_crash_before_commit");
        }
        const key = [
          where.matchId_market_lineKey_horizon.matchId,
          where.matchId_market_lineKey_horizon.market,
          where.matchId_market_lineKey_horizon.lineKey,
          where.matchId_market_lineKey_horizon.horizon
        ].join("|");
        const existing = publishedByKey.get(key);
        if (existing) {
          publishedByKey.set(key, {
            ...existing,
            predictionRunId: update.predictionRunId
          });
          return { ...existing, ...update };
        }
        const created = {
          matchId: create.matchId,
          market: create.market,
          lineKey: create.lineKey,
          horizon: create.horizon,
          predictionRunId: create.predictionRunId
        };
        publishedByKey.set(key, created);
        return created;
      })
    }
  };

  const prisma = {
    match: {
      findUnique: jest.fn().mockResolvedValue({
        leagueId: "league-1"
      })
    },
    $transaction: jest.fn().mockImplementation(async (handler: (txClient: typeof tx) => Promise<unknown>) => {
      transactionAttempts += 1;
      if (options?.failFirstTransactionWithP2034 && transactionAttempts === 1) {
        throw { code: "P2034" };
      }
      return handler(tx);
    })
  };

  return {
    prisma,
    tx,
    runs,
    publishedByKey
  };
}

describe("PredictionRunPublisherService", () => {
  it("retries P2034 and publishes pointer once for duplicate trigger scope", async () => {
    const stub = createPrismaStub({ failFirstTransactionWithP2034: true });
    const service = new PredictionRunPublisherService(
      stub.prisma as any,
      {
        buildAndPersist: jest.fn().mockResolvedValue({
          id: "snapshot-1",
          featuresJson: {
            freshnessScore: 0.82,
            featureFamilies: { odds: { providerDisagreement: 0.03 } },
            coverageFlags: { has_odds: true, has_lineup: true, missing_stats_ratio: 0.12 }
          },
          coverage: { has_odds: true, has_lineup: true, missing_stats_ratio: 0.12 }
        })
      } as any,
      {
        calibratePrediction: jest.fn().mockResolvedValue({
          calibratedProbability: 0.62,
          confidenceScore: 0.58,
          calibration: {
            sampleSize: 12,
            avgPredicted: 0.61,
            empiricalRate: 0.59,
            brierScore: 0.22,
            logLoss: 0.64,
            ece: 0.04
          },
          riskFlags: []
        })
      } as any,
      {
        recordComparison: jest.fn().mockResolvedValue(null)
      } as any,
      {
        isEnabled: jest.fn().mockResolvedValue(false)
      } as any,
      {
        buildAndPersist: jest.fn().mockResolvedValue({
          id: "lineup-1",
          lineupJson: {},
          coverageJson: {}
        })
      } as any,
      {
        buildAndPersist: jest.fn().mockResolvedValue({
          id: "event-1",
          aggregateJson: {},
          coverageJson: {}
        })
      } as any,
      {
        buildAndPersist: jest.fn().mockResolvedValue({
          id: "consensus-1",
          consensusJson: {}
        })
      } as any,
      {
        refine: jest.fn()
      } as any,
      {
        buildAndPersist: jest.fn().mockImplementation(async (_tx: unknown, input: any) => ({
          id: "candidate-1",
          matchId: input.matchId,
          market: input.market,
          line: input.line,
          lineKey: input.line === null ? "na" : Number(input.line).toFixed(2),
          horizon: input.horizon,
          selection: input.selection,
          predictionRunId: input.predictionRunId,
          modelVersionId: input.modelVersionId ?? null,
          calibrationVersionId: input.calibrationVersionId ?? null,
          calibratedProbability: input.calibratedProbability,
          confidence: input.confidence,
          publishScore: input.publishScore,
          fairOdds: input.fairOdds ?? null,
          edge: input.edge ?? null,
          freshnessScore: input.freshnessScore ?? null,
          coverageFlagsJson: input.coverageFlags ?? null,
          volatilityScore: input.volatilityScore ?? null,
          providerDisagreement: input.providerDisagreement ?? null,
          lineupCoverage: input.lineupCoverage ?? null,
          eventCoverage: input.eventCoverage ?? null
        }))
      } as any,
      {
        evaluateAndPersist: jest.fn().mockResolvedValue({
          decision: { id: "decision-1" },
          status: "APPROVED",
          shouldPublishPublic: true,
          shouldPublishByDecision: true,
          selectionScore: 0.71
        })
      } as any,
      {
        getEngineSettings: jest.fn().mockResolvedValue({
          enabled: true,
          shadowMode: false,
          defaultProfile: "BALANCED",
          emergencyRollback: false
        }),
        resolveStrategyProfile: jest.fn().mockResolvedValue({
          profileKey: "BALANCED",
          profileConfig: {
            minConfidence: 0.56,
            minPublishScore: 0.58,
            minEdge: 0,
            maxVolatility: 0.34,
            maxProviderDisagreement: 0.25,
            minLineupCoverage: 0.45,
            minEventCoverage: 0.3,
            maxMissingStatsRatio: 0.55,
            minFreshnessScore: 0.4,
            maxPicksPerMatch: 2,
            requireOdds: true,
            valueOnly: false,
            requireLineupHorizons: [],
            allowedMarkets: [],
            allowedHorizons: [],
            allowedLeagueIds: []
          },
          policyVersionId: "policy-v1",
          policyVersionLabel: "v1"
        })
      } as any
    );

    await service.publish({
      matchId: "match-1",
      matchStatus: MatchStatus.scheduled,
      kickoffAt: new Date("2026-04-17T18:00:00.000Z"),
      market: "match_outcome",
      line: null,
      modelVersionId: "model-1",
      probability: 0.62,
      confidence: 0.58,
      riskFlags: [],
      explanation: { summary: "test" }
    });

    await service.publish({
      matchId: "match-1",
      matchStatus: MatchStatus.scheduled,
      kickoffAt: new Date("2026-04-17T18:00:00.000Z"),
      market: "match_outcome",
      line: null,
      modelVersionId: "model-1",
      probability: 0.64,
      confidence: 0.6,
      riskFlags: [],
      explanation: { summary: "test-2" }
    });

    expect(stub.prisma.$transaction).toHaveBeenCalledTimes(3);
    expect(stub.runs.length).toBe(2);
    expect(stub.publishedByKey.size).toBe(1);
    const onlyPublished = [...stub.publishedByKey.values()][0];
    expect(onlyPublished.predictionRunId).toBe("run-2");
  });

  it("rerun after crash keeps published pointer idempotent by key", async () => {
    const stub = createPrismaStub({ failFirstUpsert: true });
    const service = new PredictionRunPublisherService(
      stub.prisma as any,
      {
        buildAndPersist: jest.fn().mockResolvedValue({
          id: "snapshot-2",
          featuresJson: {
            freshnessScore: 0.79,
            featureFamilies: { odds: { providerDisagreement: 0.05 } },
            coverageFlags: { has_odds: true, has_lineup: false, missing_stats_ratio: 0.2 }
          },
          coverage: { has_odds: true, has_lineup: false, missing_stats_ratio: 0.2 }
        })
      } as any,
      {
        calibratePrediction: jest.fn().mockResolvedValue({
          calibratedProbability: 0.71,
          confidenceScore: 0.63,
          calibration: {
            sampleSize: 16,
            avgPredicted: 0.68,
            empiricalRate: 0.66,
            brierScore: 0.24,
            logLoss: 0.66,
            ece: 0.05
          },
          riskFlags: []
        })
      } as any,
      {
        recordComparison: jest.fn().mockResolvedValue(null)
      } as any,
      {
        isEnabled: jest.fn().mockResolvedValue(false)
      } as any,
      {
        buildAndPersist: jest.fn().mockResolvedValue({
          id: "lineup-2",
          lineupJson: {},
          coverageJson: {}
        })
      } as any,
      {
        buildAndPersist: jest.fn().mockResolvedValue({
          id: "event-2",
          aggregateJson: {},
          coverageJson: {}
        })
      } as any,
      {
        buildAndPersist: jest.fn().mockResolvedValue({
          id: "consensus-2",
          consensusJson: {}
        })
      } as any,
      {
        refine: jest.fn()
      } as any,
      {
        buildAndPersist: jest.fn().mockImplementation(async (_tx: unknown, input: any) => ({
          id: "candidate-2",
          matchId: input.matchId,
          market: input.market,
          line: input.line,
          lineKey: input.line === null ? "na" : Number(input.line).toFixed(2),
          horizon: input.horizon,
          selection: input.selection,
          predictionRunId: input.predictionRunId,
          modelVersionId: input.modelVersionId ?? null,
          calibrationVersionId: input.calibrationVersionId ?? null,
          calibratedProbability: input.calibratedProbability,
          confidence: input.confidence,
          publishScore: input.publishScore,
          fairOdds: input.fairOdds ?? null,
          edge: input.edge ?? null,
          freshnessScore: input.freshnessScore ?? null,
          coverageFlagsJson: input.coverageFlags ?? null,
          volatilityScore: input.volatilityScore ?? null,
          providerDisagreement: input.providerDisagreement ?? null,
          lineupCoverage: input.lineupCoverage ?? null,
          eventCoverage: input.eventCoverage ?? null
        }))
      } as any,
      {
        evaluateAndPersist: jest.fn().mockResolvedValue({
          decision: { id: "decision-2" },
          status: "APPROVED",
          shouldPublishPublic: true,
          shouldPublishByDecision: true,
          selectionScore: 0.73
        })
      } as any,
      {
        getEngineSettings: jest.fn().mockResolvedValue({
          enabled: true,
          shadowMode: false,
          defaultProfile: "BALANCED",
          emergencyRollback: false
        }),
        resolveStrategyProfile: jest.fn().mockResolvedValue({
          profileKey: "BALANCED",
          profileConfig: {
            minConfidence: 0.56,
            minPublishScore: 0.58,
            minEdge: 0,
            maxVolatility: 0.34,
            maxProviderDisagreement: 0.25,
            minLineupCoverage: 0.45,
            minEventCoverage: 0.3,
            maxMissingStatsRatio: 0.55,
            minFreshnessScore: 0.4,
            maxPicksPerMatch: 2,
            requireOdds: true,
            valueOnly: false,
            requireLineupHorizons: [],
            allowedMarkets: [],
            allowedHorizons: [],
            allowedLeagueIds: []
          },
          policyVersionId: "policy-v1",
          policyVersionLabel: "v1"
        })
      } as any
    );

    await expect(
      service.publish({
        matchId: "match-2",
        matchStatus: MatchStatus.live,
        kickoffAt: new Date("2026-04-17T16:00:00.000Z"),
        elapsedMinute: 21,
        market: "moneyline",
        line: null,
        modelVersionId: "model-2",
        probability: 0.71,
        confidence: 0.63,
        riskFlags: [],
        explanation: { summary: "first-attempt" }
      })
    ).rejects.toThrow("simulated_crash_before_commit");

    await service.publish({
      matchId: "match-2",
      matchStatus: MatchStatus.live,
      kickoffAt: new Date("2026-04-17T16:00:00.000Z"),
      elapsedMinute: 21,
      market: "moneyline",
      line: null,
      modelVersionId: "model-2",
      probability: 0.69,
      confidence: 0.61,
      riskFlags: [],
      explanation: { summary: "retry-attempt" }
    });

    expect(stub.runs.length).toBe(2);
    expect(stub.publishedByKey.size).toBe(1);
    const onlyPublished = [...stub.publishedByKey.values()][0];
    expect(onlyPublished.horizon).toBe("LIVE_16_30");
    expect(onlyPublished.predictionRunId).toBe("run-2");
  });
});
