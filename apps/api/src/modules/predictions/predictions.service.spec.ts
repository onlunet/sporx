import { MatchStatus } from "@prisma/client";
import { CacheService } from "../../cache/cache.service";
import { OddsService } from "../odds/odds.service";
import { PredictionsService } from "./predictions.service";
import { BasketballPredictionStrategy } from "./sport-strategies/basketball-prediction.strategy";
import { FootballPredictionStrategy } from "./sport-strategies/football-prediction.strategy";
import { PredictionSportStrategyRegistry } from "./sport-strategies/prediction-sport-strategy.registry";

function createPublishedRow(runId: string, summary = "test summary") {
  return {
    matchId: "match-1",
    market: "match_outcome",
    line: null,
    lineKey: "na",
    horizon: "pre_match",
    publishedAt: new Date("2026-04-17T10:00:00.000Z"),
    predictionRun: {
      modelVersionId: "model-1",
      modelVersion: { modelName: "football-core", version: "v1" },
      featureSnapshot: { cutoffAt: new Date("2026-04-17T08:00:00.000Z"), featureSetVersion: "fs-v1" },
      metaModelRuns: [
        {
          cutoffAt: new Date("2026-04-17T08:30:00.000Z"),
          featureCoverageJson: { lineup: 0.8, odds: 0.9 },
          modelVersion: "meta-v1",
          isFallback: false,
          fallbackReason: null,
          createdAt: new Date("2026-04-17T09:58:00.000Z")
        }
      ],
      probability: 0.62,
      fairOdds: 1.61,
      edge: 0.07,
      confidence: 0.58,
      riskFlagsJson: [],
      explanationJson: {
        summary,
        selectedSide: "home",
        probabilities: {
          home: 0.62,
          draw: 0.22,
          away: 0.16
        },
        calibratedProbabilities: {
          home: 0.62,
          draw: 0.22,
          away: 0.16
        },
        rawProbabilities: {
          home: 0.6,
          draw: 0.24,
          away: 0.16
        },
        expectedScore: {
          home: 1.7,
          away: 1.1
        }
      },
      oddsSnapshot: {
        decimalOdds: 1.92,
        normalizedProb: 0.55,
        bookmaker: "MockBook",
        provider: "odds_api_io",
        selection: "home"
      },
      createdAt: new Date("2026-04-17T09:59:00.000Z"),
      id: runId
    },
    publishDecision: {
      status: "APPROVED",
      selectionScore: 0.74,
      confidence: 0.58,
      publishScore: 0.7,
      fairOdds: 1.61,
      edge: 0.07,
      volatilityScore: 0.1,
      providerDisagreement: 0.03,
      strategyProfile: "BALANCED"
    },
    match: {
      sport: { code: "football" },
      status: MatchStatus.scheduled,
      matchDateTimeUTC: new Date("2026-04-18T18:00:00.000Z"),
      homeScore: null,
      awayScore: null,
      halfTimeHomeScore: null,
      halfTimeAwayScore: null,
      q1HomeScore: null,
      q1AwayScore: null,
      q2HomeScore: null,
      q2AwayScore: null,
      q3HomeScore: null,
      q3AwayScore: null,
      q4HomeScore: null,
      q4AwayScore: null,
      homeTeam: { name: "Team A" },
      awayTeam: { name: "Team B" },
      league: { id: "league-1", name: "League 1", code: "L1" }
    }
  };
}

function createLegacyRow() {
  return {
    matchId: "match-legacy-1",
    modelVersionId: "legacy-model-1",
    probabilities: {
      home: 0.57,
      draw: 0.24,
      away: 0.19
    },
    calibratedProbabilities: {
      home: 0.56,
      draw: 0.25,
      away: 0.19
    },
    rawProbabilities: {
      home: 0.58,
      draw: 0.23,
      away: 0.19
    },
    expectedScore: {
      home: 1.6,
      away: 1.0
    },
    confidenceScore: 0.61,
    summary: "legacy summary",
    riskFlags: [],
    avoidReason: null,
    updatedAt: new Date("2026-04-18T10:00:00.000Z"),
    match: {
      sport: { code: "football" },
      status: MatchStatus.scheduled,
      matchDateTimeUTC: new Date("2026-04-20T18:00:00.000Z"),
      homeScore: null,
      awayScore: null,
      halfTimeHomeScore: null,
      halfTimeAwayScore: null,
      q1HomeScore: null,
      q1AwayScore: null,
      q2HomeScore: null,
      q2AwayScore: null,
      q3HomeScore: null,
      q3AwayScore: null,
      q4HomeScore: null,
      q4AwayScore: null,
      homeTeam: { name: "Legacy A" },
      awayTeam: { name: "Legacy B" },
      league: { id: "league-legacy", name: "Legacy League", code: "LL" }
    }
  };
}

function createPredictionRunRow() {
  return {
    id: "run-fallback-1",
    matchId: "match-run-1",
    market: "match_outcome",
    line: null,
    lineKey: "na",
    horizon: "pre_match",
    modelVersionId: "run-model-1",
    modelVersion: { modelName: "run-core", version: "v2" },
    featureSnapshot: { cutoffAt: new Date("2026-04-18T10:30:00.000Z"), featureSetVersion: "fs-v2" },
    metaModelRuns: [
      {
        cutoffAt: new Date("2026-04-18T10:45:00.000Z"),
        featureCoverageJson: { lineup: 0.7 },
        modelVersion: "run-meta-v2",
        isFallback: false,
        fallbackReason: null,
        createdAt: new Date("2026-04-18T10:59:00.000Z")
      }
    ],
    probability: 0.63,
    confidence: 0.64,
    riskFlagsJson: [],
    explanationJson: {
      summary: "run summary",
      selectedSide: "home",
      probabilities: {
        home: 0.63,
        draw: 0.21,
        away: 0.16
      },
      calibratedProbabilities: {
        home: 0.62,
        draw: 0.22,
        away: 0.16
      },
      rawProbabilities: {
        home: 0.64,
        draw: 0.2,
        away: 0.16
      },
      expectedScore: {
        home: 1.8,
        away: 1.0
      }
    },
    createdAt: new Date("2026-04-18T11:00:00.000Z"),
    match: {
      sport: { code: "football" },
      status: MatchStatus.scheduled,
      matchDateTimeUTC: new Date("2026-04-21T18:00:00.000Z"),
      homeScore: null,
      awayScore: null,
      halfTimeHomeScore: null,
      halfTimeAwayScore: null,
      q1HomeScore: null,
      q1AwayScore: null,
      q2HomeScore: null,
      q2AwayScore: null,
      q3HomeScore: null,
      q3AwayScore: null,
      q4HomeScore: null,
      q4AwayScore: null,
      homeTeam: { name: "Run A" },
      awayTeam: { name: "Run B" },
      league: { id: "league-run", name: "Run League", code: "RL" }
    }
  };
}

function createSyntheticPredictionRunRow() {
  return {
    ...createPredictionRunRow(),
    explanationJson: {
      summary: "Yayinlanmis tahmin kaydi bulunamadigi icin mac verisine dayali gecici tahmin gosterimi kullaniliyor.",
      selectedSide: "home",
      probabilities: {
        home: 0.5,
        draw: 0.25,
        away: 0.25
      }
    }
  };
}

function expectNoQuarterScoreSelect(select: Record<string, unknown>) {
  expect(select).not.toHaveProperty("q1HomeScore");
  expect(select).not.toHaveProperty("q1AwayScore");
  expect(select).not.toHaveProperty("q2HomeScore");
  expect(select).not.toHaveProperty("q2AwayScore");
  expect(select).not.toHaveProperty("q3HomeScore");
  expect(select).not.toHaveProperty("q3AwayScore");
  expect(select).not.toHaveProperty("q4HomeScore");
  expect(select).not.toHaveProperty("q4AwayScore");
}

describe("PredictionsService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("public match query returns one row per duplicate published tuple", async () => {
    const prisma = {
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([createPublishedRow("run-1"), createPublishedRow("run-2")])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as any;
    const cache = {} as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.listByMatch("match-1");

    const fullTimeRows = items.filter(
      (item) => item.matchId === "match-1" && item.predictionType === "fullTimeResult" && item.marketKey === "match_outcome"
    );
    expect(fullTimeRows).toHaveLength(1);
    expect(prisma.prediction.findMany).not.toHaveBeenCalled();
    expect(rollout.resolveSource).not.toHaveBeenCalled();
    expect(fullTimeRows[0]).toEqual(
      expect.objectContaining({
        sourceType: "published",
        modelVersion: "meta-v1",
        horizon: "pre_match",
        cutoffAt: "2026-04-17T08:30:00.000Z",
        featureCoverage: { lineup: 0.8, odds: 0.9 },
        offeredOdds: 1.92,
        fairOdds: 1.61,
        edge: 0.07,
        bookmaker: "MockBook",
        oddsProvider: "odds_api_io"
      })
    );
  });

  it("list endpoint reads only published source when rollout selects published", async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([{ id: "match-1", matchDateTimeUTC: new Date("2026-04-18T18:00:00.000Z") }])
      },
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([createPublishedRow("run-live")])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.list({ status: "scheduled", sport: "football", take: 10 });

    expect(prisma.publishedPrediction.findMany).toHaveBeenCalled();
    expect(prisma.prediction.findMany).not.toHaveBeenCalled();
    expect(rollout.resolveSource).not.toHaveBeenCalled();
    expect(items.length).toBeGreaterThan(0);
  });

  it("builds five football coupons with five legs each from top prediction pool", async () => {
    const kickoff = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const service = new PredictionsService({} as any, {} as any, {} as any, strategyRegistry, {} as any);
    const source = Array.from({ length: 25 }, (_, index) => ({
      matchId: `match-${index + 1}`,
      predictionType: "fullTimeResult" as const,
      selectionLabel: index % 2 === 0 ? "1" : "2",
      confidenceScore: 0.82 - index * 0.008,
      selectionScore: 0.8 - index * 0.006,
      publishScore: 0.78 - index * 0.005,
      offeredOdds: 1.45 + index * 0.06,
      fairOdds: 1.38 + index * 0.05,
      edge: 0.09 - index * 0.001,
      bookmaker: "MockBook",
      oddsProvider: "odds_api_io",
      riskTier: index < 5 ? "elite" : index < 10 ? "low" : index < 15 ? "balanced" : index < 20 ? "assertive" : "high",
      homeTeam: `Home ${index + 1}`,
      awayTeam: `Away ${index + 1}`,
      leagueName: "League 1",
      matchDateTimeUTC: kickoff,
      riskFlags: []
    }));

    jest.spyOn(service, "list").mockResolvedValue(source as any);

    const response = await service.listFootballCoupons();

    expect(response.coupons).toHaveLength(5);
    expect(response.coupons.map((coupon) => coupon.riskLevel)).toEqual([
      "elite",
      "low",
      "balanced",
      "assertive",
      "high"
    ]);
    for (const coupon of response.coupons) {
      expect(coupon.legs).toHaveLength(5);
      expect(coupon.combinedOdds).not.toBeNull();
    }
  });

  it("list endpoint rewrites synthetic published summary to model-style summary", async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([{ id: "match-1", matchDateTimeUTC: new Date("2026-04-18T18:00:00.000Z") }])
      },
      publishedPrediction: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            createPublishedRow(
              "run-synthetic-summary",
              "Yayinlanmis tahmin kaydi bulunamadigi icin mac verisine dayali gecici tahmin gosterimi kullaniliyor."
            )
          ])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.list({ status: "scheduled", sport: "football", take: 10 });
    const first = items[0] as any;

    expect(items.length).toBeGreaterThan(0);
    expect(first?.summary).toContain("Team A - Team B: model analizi Ev");
    expect(first?.summary).not.toContain("gecici tahmin gosterimi");
  });

  it("list endpoint rewrites Turkish synthetic summary variants to model-style summary", async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([{ id: "match-1", matchDateTimeUTC: new Date("2026-04-18T18:00:00.000Z") }])
      },
      publishedPrediction: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            createPublishedRow(
              "run-synthetic-summary-tr",
              "Yayınlanmış tahmin kaydı bulunamadığı için maç verisine dayalı geçici tahmin gösterimi kullanılıyor."
            )
          ])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.list({ status: "scheduled", sport: "football", take: 10 });
    const first = items[0] as any;

    expect(items.length).toBeGreaterThan(0);
    expect(first?.summary).toContain("Team A - Team B: model analizi Ev");
    expect(first?.summary.toLocaleLowerCase("tr-TR")).not.toContain("geçici tahmin");
  });

  it("list endpoint falls back to legacy rows when published source is empty", async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([{ id: "match-legacy-1", matchDateTimeUTC: new Date("2026-04-20T18:00:00.000Z") }])
      },
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([createLegacyRow()])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.list({ status: "scheduled", sport: "football", take: 10 });

    expect(prisma.publishedPrediction.findMany).toHaveBeenCalled();
    expect(prisma.prediction.findMany).toHaveBeenCalled();
    expectNoQuarterScoreSelect(prisma.publishedPrediction.findMany.mock.calls[0][0].include.match.select);
    expectNoQuarterScoreSelect(prisma.prediction.findMany.mock.calls[0][0].include.match.select);
    expect(items.length).toBeGreaterThan(0);
    expect((items[0] as any)?.homeTeam).toBe("Legacy A");
    expect((items[0] as any)?.sourceType).toBe("legacy");
    expect((items[0] as any)?.horizon).toBeNull();
  });

  it("list endpoint falls back to prediction runs when published and legacy are empty", async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([{ id: "match-run-1", matchDateTimeUTC: new Date("2026-04-21T18:00:00.000Z") }])
      },
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      },
      predictionRun: {
        findMany: jest.fn().mockResolvedValue([createPredictionRunRow()])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.list({ status: "scheduled", sport: "football", take: 10 });

    expect(prisma.publishedPrediction.findMany).toHaveBeenCalled();
    expect(prisma.prediction.findMany).toHaveBeenCalled();
    expect(prisma.predictionRun.findMany).toHaveBeenCalled();
    expectNoQuarterScoreSelect(prisma.predictionRun.findMany.mock.calls[0][0].include.match.select);
    expect(items.length).toBeGreaterThan(0);
    expect((items[0] as any)?.homeTeam).toBe("Run A");
    expect((items[0] as any)?.sourceType).toBe("prediction_run_fallback");
    expect((items[0] as any)?.modelVersion).toBe("run-meta-v2");
    expect((items[0] as any)?.horizon).toBe("pre_match");
    expect((items[0] as any)?.cutoffAt).toBe("2026-04-18T10:45:00.000Z");
  });

  it("list endpoint self-heals published rows from prediction runs when published source is empty", async () => {
    const publishedFindMany = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createPublishedRow("run-materialized", "run summary")]);
    const publishedUpsert = jest.fn().mockResolvedValue({});
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([{ id: "match-run-1", matchDateTimeUTC: new Date("2026-04-21T18:00:00.000Z") }])
      },
      publishedPrediction: {
        findMany: publishedFindMany,
        upsert: publishedUpsert
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      },
      predictionRun: {
        findMany: jest.fn().mockResolvedValue([createPredictionRunRow()])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.list({ status: "scheduled", sport: "football", take: 10 });

    expect(prisma.predictionRun.findMany).toHaveBeenCalled();
    expect(publishedUpsert).toHaveBeenCalled();
    expect(items.length).toBeGreaterThan(0);
  });

  it("list endpoint returns empty when all real sources are empty and synthetic fallback is disabled", async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "match-synthetic-1",
            matchDateTimeUTC: new Date("2026-04-22T18:00:00.000Z"),
            status: MatchStatus.scheduled,
            homeScore: null,
            awayScore: null,
            halfTimeHomeScore: null,
            halfTimeAwayScore: null
          }
        ])
      },
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      },
      predictionRun: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.list({ status: "scheduled", sport: "football", take: 10 });

    expect(prisma.publishedPrediction.findMany).toHaveBeenCalled();
    expect(prisma.prediction.findMany).toHaveBeenCalled();
    expect(prisma.predictionRun.findMany).toHaveBeenCalled();
    expect(items).toEqual([]);
  });

  it("list endpoint can use synthetic rows only when explicit flag is enabled", async () => {
    const previous = process.env.PUBLIC_PREDICTIONS_SYNTHETIC_FALLBACK;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.PUBLIC_PREDICTIONS_SYNTHETIC_FALLBACK = "1";
    process.env.NODE_ENV = "test";
    try {
      const prisma = {
        match: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "match-synthetic-1",
              matchDateTimeUTC: new Date("2026-04-22T18:00:00.000Z"),
              status: MatchStatus.scheduled,
              homeScore: null,
              awayScore: null,
              halfTimeHomeScore: null,
              halfTimeAwayScore: null
            }
          ])
        },
        publishedPrediction: {
          findMany: jest.fn().mockResolvedValue([])
        },
        prediction: {
          findMany: jest.fn().mockResolvedValue([])
        },
        predictionRun: {
          findMany: jest.fn().mockResolvedValue([])
        }
      } as any;

      const cache = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined)
      } as unknown as CacheService;
      const oddsService = {
        attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
      } as unknown as OddsService;
      const strategyRegistry = new PredictionSportStrategyRegistry(
        new FootballPredictionStrategy(),
        new BasketballPredictionStrategy()
      );
      const rollout = {
        resolveSource: jest.fn().mockResolvedValue("published")
      };

      const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
      const items = await service.list({ status: "scheduled", sport: "football", take: 10 });

      expect(items.length).toBeGreaterThan(0);
      expect((items[0] as any)?.homeTeam).toContain("Ev Takim");
      expect((items[0] as any)?.sourceType).toBe("synthetic");
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previous === undefined) {
        delete process.env.PUBLIC_PREDICTIONS_SYNTHETIC_FALLBACK;
      } else {
        process.env.PUBLIC_PREDICTIONS_SYNTHETIC_FALLBACK = previous;
      }
    }
  });

  it("list endpoint skips synthetic prediction-run fallback rows in production", async () => {
    const previous = process.env.PUBLIC_PREDICTIONS_SYNTHETIC_FALLBACK;
    const previousNodeEnv = process.env.NODE_ENV;
    process.env.PUBLIC_PREDICTIONS_SYNTHETIC_FALLBACK = "1";
    process.env.NODE_ENV = "production";

    try {
      const prisma = {
        match: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: "match-run-1",
              matchDateTimeUTC: new Date("2026-04-21T18:00:00.000Z"),
              status: MatchStatus.scheduled,
              homeScore: null,
              awayScore: null,
              halfTimeHomeScore: null,
              halfTimeAwayScore: null,
              homeTeam: { name: "Run A" },
              awayTeam: { name: "Run B" },
              league: { id: "league-run", name: "Run League", code: "RL" },
              sport: { code: "football" }
            }
          ])
        },
        publishedPrediction: {
          findMany: jest.fn().mockResolvedValue([])
        },
        prediction: {
          findMany: jest.fn().mockResolvedValue([])
        },
        predictionRun: {
          findMany: jest.fn().mockResolvedValue([createSyntheticPredictionRunRow()])
        }
      } as any;

      const cache = {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue(undefined)
      } as unknown as CacheService;
      const oddsService = {
        attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
      } as unknown as OddsService;
      const strategyRegistry = new PredictionSportStrategyRegistry(
        new FootballPredictionStrategy(),
        new BasketballPredictionStrategy()
      );
      const rollout = {
        resolveSource: jest.fn().mockResolvedValue("published")
      };

      const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
      const items = await service.list({ status: "scheduled", sport: "football", take: 10 });

      expect(items).toEqual([]);
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previous === undefined) {
        delete process.env.PUBLIC_PREDICTIONS_SYNTHETIC_FALLBACK;
      } else {
        process.env.PUBLIC_PREDICTIONS_SYNTHETIC_FALLBACK = previous;
      }
    }
  });

  it("list endpoint requests only approved/manually-forced published decisions", async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([{ id: "match-1", matchDateTimeUTC: new Date("2026-04-18T18:00:00.000Z") }])
      },
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([createPublishedRow("run-allowed")])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    await service.list({ status: "scheduled", sport: "football", take: 5 });

    const firstCallArg = prisma.publishedPrediction.findMany.mock.calls[0][0];
    const decisionGate =
      firstCallArg.where?.AND?.find((item: { OR?: unknown }) => Array.isArray(item?.OR))?.OR ??
      firstCallArg.where?.OR;

    expect(decisionGate).toEqual(
      expect.arrayContaining([
        { publishDecision: { is: null } },
        {
          publishDecision: {
            is: {
              status: {
                in: expect.arrayContaining(["APPROVED", "MANUALLY_FORCED"])
              }
            }
          }
        }
      ])
    );
    expect(rollout.resolveSource).not.toHaveBeenCalled();
  });

  it("list endpoint excludes future-dated finished rows from finished results", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-20T00:30:00.000Z"));

    const futureBase = createPublishedRow("run-future-finished");
    const futureFinished = {
      ...futureBase,
      matchId: "match-future",
      match: {
        ...futureBase.match,
        status: MatchStatus.finished,
        matchDateTimeUTC: new Date("2026-04-20T01:30:00.000Z"),
        homeScore: 1,
        awayScore: 0
      }
    };

    const completedBase = createPublishedRow("run-completed");
    const completed = {
      ...completedBase,
      matchId: "match-completed",
      match: {
        ...completedBase.match,
        status: MatchStatus.finished,
        matchDateTimeUTC: new Date("2026-04-19T18:00:00.000Z"),
        homeScore: 2,
        awayScore: 1
      }
    };

    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          { id: "match-future", matchDateTimeUTC: futureFinished.match.matchDateTimeUTC },
          { id: "match-completed", matchDateTimeUTC: completed.match.matchDateTimeUTC }
        ])
      },
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([futureFinished, completed])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.list({ status: "finished", sport: "football", take: 10 });

    const matchIds = Array.from(new Set(items.map((item) => (item as any).matchId)));
    expect(matchIds).toEqual(["match-completed"]);
    expect(items.every((item) => (item as any).matchStatus === MatchStatus.finished)).toBe(true);
  });

  it("list endpoint remaps future-dated finished rows into live feed", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-20T00:30:00.000Z"));

    const futureBase = createPublishedRow("run-live-from-finished");
    const futureFinished = {
      ...futureBase,
      matchId: "match-live",
      match: {
        ...futureBase.match,
        status: MatchStatus.finished,
        matchDateTimeUTC: new Date("2026-04-20T01:30:00.000Z"),
        homeScore: 1,
        awayScore: 0
      }
    };

    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([{ id: "match-live", matchDateTimeUTC: futureFinished.match.matchDateTimeUTC }])
      },
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([futureFinished])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as any;

    const cache = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn().mockResolvedValue(undefined)
    } as unknown as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.list({ status: "live", sport: "football", take: 10 });

    expect(items.length).toBeGreaterThan(0);
    expect(Array.from(new Set(items.map((item) => (item as any).matchId)))).toEqual(["match-live"]);
    expect(items.every((item) => (item as any).matchStatus === MatchStatus.live)).toBe(true);
  });

  it("high confidence endpoint reads published predictions only", async () => {
    const prisma = {
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([createPublishedRow("run-high")])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([])
      }
    } as any;
    const cache = {} as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("legacy")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.highConfidence();

    expect(items).toHaveLength(1);
    expect(prisma.publishedPrediction.findMany).toHaveBeenCalled();
    expect(prisma.prediction.findMany).not.toHaveBeenCalled();
    expect(rollout.resolveSource).not.toHaveBeenCalled();
  });

  it("high confidence endpoint falls back to legacy source when published is empty", async () => {
    const legacy = createLegacyRow();
    legacy.confidenceScore = 0.76;

    const prisma = {
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue([])
      },
      prediction: {
        findMany: jest.fn().mockResolvedValue([legacy])
      }
    } as any;
    const cache = {} as CacheService;
    const oddsService = {
      attachMarketAnalysis: jest.fn(async (items: unknown[]) => items)
    } as unknown as OddsService;
    const strategyRegistry = new PredictionSportStrategyRegistry(
      new FootballPredictionStrategy(),
      new BasketballPredictionStrategy()
    );
    const rollout = {
      resolveSource: jest.fn().mockResolvedValue("published")
    };

    const service = new PredictionsService(prisma, cache, oddsService, strategyRegistry, rollout as any);
    const items = await service.highConfidence();

    expect(prisma.publishedPrediction.findMany).toHaveBeenCalled();
    expect(prisma.prediction.findMany).toHaveBeenCalled();
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]?.matchId).toBe("match-legacy-1");
  });
});
