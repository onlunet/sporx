import { PublishDecisionStatus } from "@prisma/client";
import { PublishDecisionService } from "./publish-decision.service";

function createTxStub() {
  return {
    publishDecision: {
      upsert: jest.fn().mockImplementation(async ({ update }: any) => ({
        id: "decision-1",
        ...update
      })),
      updateMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    abstainReasonLog: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    publishedPrediction: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 })
    },
    policyEvaluationSnapshot: {
      create: jest.fn().mockResolvedValue({ id: "snapshot-1" })
    }
  } as any;
}

const baseInput = {
  candidate: {
    id: "candidate-1",
    matchId: "match-1",
    market: "match_outcome",
    line: null,
    lineKey: "na",
    horizon: "PRE6",
    selection: "home",
    predictionRunId: "run-1",
    modelVersionId: "model-1",
    calibrationVersionId: null,
    calibratedProbability: 0.64,
    confidence: 0.61,
    publishScore: 0.6,
    fairOdds: 1.82,
    edge: 0.03,
    freshnessScore: 0.8,
    coverageFlagsJson: {
      has_odds: true,
      has_lineup: true,
      has_event_data: true,
      missing_stats_ratio: 0.2
    },
    volatilityScore: 0.12,
    providerDisagreement: 0.08,
    lineupCoverage: 0.7,
    eventCoverage: 0.6
  },
  leagueId: "league-1",
  strategyProfile: "BALANCED" as const,
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
  policyVersionLabel: "v1_deterministic_selector"
};

const policyDiagnostics = {
  version: "publish_policy_refinement_v1",
  enabled: true,
  marketRiskProfile: "standard",
  effectiveThresholds: {
    minConfidence: 0.56,
    minPublishScore: 0.58,
    minOddsCoverage: 0.45,
    minLineupCoverage: 0.45,
    minEventCoverage: 0.3,
    maxProviderDisagreement: 0.25,
    maxVolatility: 0.34,
    maxMissingStatsRatio: 0.55,
    minCalibrationSampleSize: 40,
    minFreshnessScore: 0.4
  },
  signals: {
    confidence: 0.61,
    selectionScore: 0.7,
    oddsCoverage: 1,
    lineupCoverage: 0.7,
    eventCoverage: 0.6,
    providerDisagreement: 0.08,
    volatilityScore: 0.12,
    missingStatsRatio: 0.2,
    calibrationSampleSize: null,
    calibrationMethod: null
  },
  appliedAdjustments: {
    riskyMarket: false
  }
};

describe("PublishDecisionService", () => {
  it("produces deterministic decisions for identical inputs", async () => {
    const service = new PublishDecisionService(
      {
        score: jest.fn().mockReturnValue({
          score: 0.7,
          breakdown: { confidence: 0.7 }
        })
      } as any,
      {
        evaluate: jest.fn().mockReturnValue([]),
        diagnostics: jest.fn().mockReturnValue(policyDiagnostics)
      } as any,
      {
        resolve: jest.fn().mockResolvedValue({
          suppressed: false,
          reasons: [],
          suppressedDecisionIds: []
        })
      } as any,
      {
        resolveManualOverride: jest.fn().mockResolvedValue(null),
        getConflictRules: jest.fn().mockResolvedValue([])
      } as any
    );

    const tx = createTxStub();
    const first = await service.evaluateAndPersist({
      tx,
      ...baseInput,
      settings: {
        enabled: true,
        shadowMode: false,
        defaultProfile: "BALANCED",
        emergencyRollback: false
      }
    });
    const second = await service.evaluateAndPersist({
      tx,
      ...baseInput,
      settings: {
        enabled: true,
        shadowMode: false,
        defaultProfile: "BALANCED",
        emergencyRollback: false
      }
    });

    expect(first.status).toBe(PublishDecisionStatus.APPROVED);
    expect(second.status).toBe(PublishDecisionStatus.APPROVED);
    expect(first.selectionScore).toBe(second.selectionScore);
    expect(first.reasons).toEqual(second.reasons);
    expect(first.shouldPublishPublic).toBe(second.shouldPublishPublic);
    expect(tx.publishDecision.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          detailsJson: expect.objectContaining({
            publishPolicyDiagnostics: expect.objectContaining({
              version: "publish_policy_refinement_v1",
              effectiveThresholds: expect.objectContaining({
                minConfidence: expect.any(Number),
                minPublishScore: expect.any(Number)
              })
            })
          })
        })
      })
    );
    expect(tx.policyEvaluationSnapshot.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          decisionMetrics: expect.objectContaining({
            publishPolicyDiagnostics: expect.objectContaining({
              version: "publish_policy_refinement_v1"
            })
          })
        })
      })
    );
  });

  it("shadow mode keeps public output unchanged even when selector abstains", async () => {
    const service = new PublishDecisionService(
      {
        score: jest.fn().mockReturnValue({
          score: 0.42,
          breakdown: { confidence: 0.42 }
        })
      } as any,
      {
        evaluate: jest.fn().mockReturnValue([
          {
            code: "LOW_CONFIDENCE",
            message: "Low confidence",
            severity: "high"
          }
        ]),
        diagnostics: jest.fn().mockReturnValue(policyDiagnostics)
      } as any,
      {
        resolve: jest.fn().mockResolvedValue({
          suppressed: false,
          reasons: [],
          suppressedDecisionIds: []
        })
      } as any,
      {
        resolveManualOverride: jest.fn().mockResolvedValue(null),
        getConflictRules: jest.fn().mockResolvedValue([])
      } as any
    );

    const tx = createTxStub();
    const result = await service.evaluateAndPersist({
      tx,
      ...baseInput,
      settings: {
        enabled: true,
        shadowMode: true,
        defaultProfile: "BALANCED",
        emergencyRollback: false
      }
    });

    expect(result.status).toBe(PublishDecisionStatus.ABSTAINED);
    expect(result.shouldPublishByDecision).toBe(false);
    expect(result.shouldPublishPublic).toBe(true);
  });

  it("continues when published_predictions cleanup fails due missing table", async () => {
    const service = new PublishDecisionService(
      {
        score: jest.fn().mockReturnValue({
          score: 0.71,
          breakdown: { confidence: 0.71 }
        })
      } as any,
      {
        evaluate: jest.fn().mockReturnValue([]),
        diagnostics: jest.fn().mockReturnValue(policyDiagnostics)
      } as any,
      {
        resolve: jest.fn().mockResolvedValue({
          suppressed: true,
          reasons: [],
          suppressedDecisionIds: ["suppressed-1"]
        })
      } as any,
      {
        resolveManualOverride: jest.fn().mockResolvedValue(null),
        getConflictRules: jest.fn().mockResolvedValue([])
      } as any
    );

    const tx = createTxStub();
    tx.publishedPrediction.deleteMany = jest
      .fn()
      .mockRejectedValueOnce(new Error("The table `public.published_predictions` does not exist in the current database."));

    const result = await service.evaluateAndPersist({
      tx,
      ...baseInput,
      settings: {
        enabled: true,
        shadowMode: false,
        defaultProfile: "BALANCED",
        emergencyRollback: false
      }
    });

    expect(result.status).toBe(PublishDecisionStatus.APPROVED);
    expect(tx.publishDecision.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.publishedPrediction.deleteMany).toHaveBeenCalledTimes(1);
  });
});
