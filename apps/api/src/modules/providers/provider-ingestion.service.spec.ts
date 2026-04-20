import { ProviderIngestionService } from "./provider-ingestion.service";
import { MatchStatus } from "@prisma/client";

function createService() {
  const seen = new Set<string>();
  const prisma = {
    ingestionCheckpoint: {
      findUnique: jest.fn(async ({ where }: any) => {
        const entityType = where?.providerKey_entityType?.entityType;
        if (typeof entityType === "string" && seen.has(entityType)) {
          return { providerKey: "prediction_phase_trigger", cursor: "seen-cursor" };
        }
        return null;
      }),
      create: jest.fn(async ({ data }: any) => {
        seen.add(String(data.entityType));
        return data;
      }),
      upsert: jest.fn(async ({ create, update, where }: any) => {
        const entityType = where?.providerKey_entityType?.entityType ?? create?.entityType;
        seen.add(String(entityType));
        return { ...create, ...update };
      })
    },
    apiLog: {
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue({ id: "api-log-1" })
    },
    prediction: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "prediction-1" }),
      update: jest.fn().mockResolvedValue({ id: "prediction-1" })
    },
    predictionExplanation: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: "explanation-1" }),
      update: jest.fn().mockResolvedValue({ id: "explanation-1" })
    }
  };

  const service = new ProviderIngestionService(
    prisma as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any
  );

  jest.spyOn(service as any, "createExternalPayload").mockResolvedValue(undefined);
  jest.spyOn(service as any, "generatePredictions").mockResolvedValue({
    recordsRead: 0,
    recordsWritten: 0,
    errors: 0,
    logs: {}
  });

  return { service, prisma };
}

describe("ProviderIngestionService phase triggers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("builds halftime trigger only when HT exists and FT is not final", () => {
    const { service } = createService();
    const triggers = (service as any).buildPredictionPhaseTriggers(
      {
        id: "match-1",
        kickoffAt: new Date("2026-04-18T11:00:00.000Z"),
        status: "live",
        homeScore: null,
        awayScore: null,
        halfTimeHomeScore: 1,
        halfTimeAwayScore: 0
      },
      new Date("2026-04-18T11:40:00.000Z")
    );

    expect(triggers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phase: "halftime",
          dedupKey: "match:match-1:ht:1-0",
          horizon: "HT"
        })
      ])
    );
  });

  it("keeps halftime trigger idempotent across reruns", async () => {
    const { service } = createService();
    const candidate = {
      phase: "halftime",
      dedupKey: "match:match-2:ht:2-1",
      matchId: "match-2",
      horizon: "HT",
      metadata: {}
    };

    await (service as any).processPredictionPhaseTriggers("run-1", [candidate]);
    await (service as any).processPredictionPhaseTriggers("run-2", [candidate]);

    const generatePredictions = (service as any).generatePredictions as jest.Mock;
    expect(generatePredictions).toHaveBeenCalledTimes(1);
    expect(generatePredictions).toHaveBeenCalledWith("run-1:halftime", {
      matchIds: ["match-2"],
      reason: "phase_trigger_halftime"
    });
  });

  it("keeps fulltime trigger idempotent across reruns", async () => {
    const { service } = createService();
    const candidate = {
      phase: "fulltime",
      dedupKey: "match:match-3:ft:3-1",
      matchId: "match-3",
      horizon: "POST_MATCH",
      metadata: {}
    };

    await (service as any).processPredictionPhaseTriggers("run-3", [candidate]);
    await (service as any).processPredictionPhaseTriggers("run-4", [candidate]);

    const generatePredictions = (service as any).generatePredictions as jest.Mock;
    expect(generatePredictions).toHaveBeenCalledTimes(1);
    expect(generatePredictions).toHaveBeenCalledWith("run-3:fulltime", {
      matchIds: ["match-3"],
      reason: "phase_trigger_fulltime"
    });
  });

  it("persists legacy prediction compatibility payload for real public fallback", async () => {
    const { service, prisma } = createService();

    await (service as any).upsertLegacyPredictionCompatibility({
      matchId: "match-legacy",
      modelVersionId: "model-legacy",
      probabilities: { home: 0.55, draw: 0.24, away: 0.21 },
      calibratedProbabilities: { home: 0.54, draw: 0.25, away: 0.21 },
      rawProbabilities: { home: 0.56, draw: 0.23, away: 0.21 },
      expectedScore: { home: 1.6, away: 1.1 },
      rawConfidenceScore: 0.58,
      calibratedConfidenceScore: 0.57,
      confidenceScore: 0.56,
      summary: "legacy uyumluluk tahmini",
      riskFlags: [],
      isRecommended: false,
      isLowConfidence: false,
      avoidReason: null
    });

    expect((prisma as any).prediction.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { matchId: "match-legacy" }
      })
    );
    expect((prisma as any).prediction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ matchId: "match-legacy" })
      })
    );
    expect((prisma as any).predictionExplanation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { predictionId: "prediction-1" }
      })
    );
    expect((prisma as any).predictionExplanation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ predictionId: "prediction-1" })
      })
    );
  });
});

describe("ProviderIngestionService TheSportsDB helpers", () => {
  it("parses multi-league soccer config with Turkish Super Lig first", () => {
    const { service } = createService();

    expect((service as any).theSportsDbSoccerLeagueIds({ soccerLeagueIds: ["4328", "4339", "4335"] })).toEqual([
      "4339",
      "4328",
      "4335"
    ]);
  });

  it("keeps legacy soccerLeagueId config backward compatible", () => {
    const { service } = createService();

    expect((service as any).theSportsDbSoccerLeagueIds({ soccerLeagueId: "4328" })).toEqual(["4339", "4328"]);
    expect((service as any).theSportsDbSoccerLeagueIds({ soccerLeagueId: "4339" })).toEqual(["4339"]);
  });

  it("maps TheSportsDB football statuses robustly", () => {
    const { service } = createService();

    expect((service as any).theSportsDbFootballStatus({ strStatus: "Match Finished" })).toBe(MatchStatus.finished);
    expect((service as any).theSportsDbFootballStatus({ strStatus: "NS" })).toBe(MatchStatus.scheduled);
    expect((service as any).theSportsDbFootballStatus({ strProgress: "HT" })).toBe(MatchStatus.live);
    expect((service as any).theSportsDbFootballStatus({ strStatus: "Postponed" })).toBe(MatchStatus.postponed);
    expect((service as any).theSportsDbFootballStatus({ strStatus: "Cancelled" })).toBe(MatchStatus.cancelled);
  });

  it("prefers TheSportsDB strTimestamp over date/time fields", () => {
    const { service } = createService();

    const parsed = (service as any).parseTheSportsDbEventDate({
      strTimestamp: "2026-04-19T17:00:00+03:00",
      dateEvent: "2026-04-19",
      strTime: "12:00:00"
    });

    expect(parsed.toISOString()).toBe("2026-04-19T14:00:00.000Z");
  });

  it("uses idEvent as TheSportsDB provider match key", () => {
    const { service } = createService();

    expect(
      (service as any).theSportsDbProviderMatchKey(
        { idEvent: "12345" },
        "football",
        "Galatasaray",
        "Fenerbahce",
        new Date("2026-04-19T17:00:00.000Z")
      )
    ).toBe("12345");
  });

  it("parses direct TheSportsDB half-time score fields", () => {
    const { service } = createService();

    expect(
      (service as any).readTheSportsDbDirectHalfTimeScore({
        intHomeScoreHalfTime: "1",
        intAwayScoreHalfTime: "0"
      })
    ).toEqual({ home: 1, away: 0, source: "direct" });
  });

  it("derives half-time score from reliable TheSportsDB timeline goals", () => {
    const { service } = createService();

    expect(
      (service as any).deriveTheSportsDbHalfTimeFromTimeline(
        [
          { strTimeline: "Goal", strTimelineDetail: "12' Goal", strTeam: "Galatasaray" },
          { strTimeline: "Goal", strTimelineDetail: "45+2' Goal", strTeam: "Fenerbahce" },
          { strTimeline: "Goal", strTimelineDetail: "60' Goal", strTeam: "Galatasaray" }
        ],
        "Galatasaray",
        "Fenerbahce"
      )
    ).toEqual({ home: 1, away: 1, source: "timeline_derived" });
  });

  it("collects scoped prediction match ids from provider sync results", () => {
    const { service } = createService();

    expect(
      (service as any).collectPredictionScopeMatchIds([
        {
          providerKey: "the_sports_db",
          recordsRead: 10,
          recordsWritten: 2,
          errors: 0,
          details: { matchIds: ["match-1", "match-2", "match-1", "", null] }
        },
        {
          providerKey: "api_football",
          recordsRead: 5,
          recordsWritten: 1,
          errors: 0,
          details: { matchIds: ["match-3"] }
        },
        {
          providerKey: "sportapi_ai",
          recordsRead: 3,
          recordsWritten: 0,
          errors: 0,
          details: {}
        }
      ])
    ).toEqual(["match-1", "match-2", "match-3"]);
  });

  it("skips post-sync auto prediction when provider results have no scoped match ids", async () => {
    const { service } = createService();
    (service as any).providersService = {
      listActiveApiProviders: jest.fn().mockResolvedValue([{ key: "football_data" }]),
      getProviderRuntimeSettings: jest.fn()
    };
    (service as any).incidentReadinessService = {
      getEmergencyControlStatus: jest.fn().mockResolvedValue({ disabledProviderPath: null })
    };
    jest.spyOn(service as any, "supportsProviderFetch").mockReturnValue(true);
    jest.spyOn(service as any, "normalizeStaleMatchStatuses").mockResolvedValue(undefined);
    jest.spyOn(service as any, "syncFootballData").mockResolvedValue({
      providerKey: "football_data",
      recordsRead: 10,
      recordsWritten: 4,
      errors: 0,
      details: {}
    });

    const result = await service.sync("syncResults", "run-no-scope");

    expect((service as any).generatePredictions).not.toHaveBeenCalled();
    expect(result.recordsRead).toBe(10);
    expect(result.recordsWritten).toBe(4);
    expect(result.logs).toEqual(
      expect.objectContaining({
        predictionGeneration: null
      })
    );
  });

  it("writes per-league result checkpoint and run payload summary", async () => {
    const { service, prisma } = createService();
    (service as any).providersService = {
      getProviderRuntimeSettings: jest.fn().mockResolvedValue({
        apiKey: "test-key",
        soccerLeagueIds: ["4339"],
        soccerSeason: "2025-2026",
        soccerBackfillFrom: "2026-01-01",
        dailyLimit: 10
      })
    };
    (service as any).theSportsDbConnector = {
      fetchPastSoccerEvents: jest.fn().mockResolvedValue({
        events: [
          {
            idEvent: "tsdb-1",
            strSport: "Soccer",
            idLeague: "4339",
            strLeague: "Turkish Super Lig",
            strSeason: "2025-2026",
            strTimestamp: "2026-04-19T17:00:00+03:00",
            strHomeTeam: "Galatasaray",
            strAwayTeam: "Fenerbahce",
            intHomeScore: "2",
            intAwayScore: "1",
            intHomeScoreHalfTime: "1",
            intAwayScoreHalfTime: "0",
            strStatus: "Match Finished"
          }
        ]
      }),
      fetchSoccerSeasonEvents: jest.fn().mockResolvedValue({ events: [] })
    };
    jest.spyOn(service as any, "upsertMatchFromExternal").mockResolvedValue({
      id: "match-1",
      kickoffAt: new Date("2026-04-19T14:00:00.000Z"),
      status: MatchStatus.finished,
      homeScore: 2,
      awayScore: 1,
      halfTimeHomeScore: 1,
      halfTimeAwayScore: 0
    });
    jest.spyOn(service as any, "applyContextPatchToFeatureSnapshot").mockResolvedValue(undefined);

    const result = await (service as any).syncTheSportsDb(
      { id: "provider-1", key: "the_sports_db", baseUrl: null },
      "run-tsdb",
      "syncResults"
    );

    expect((service as any).theSportsDbConnector.fetchPastSoccerEvents).toHaveBeenCalledWith(
      "test-key",
      "4339",
      undefined
    );
    expect((service as any).theSportsDbConnector.fetchSoccerSeasonEvents).toHaveBeenCalledWith(
      "test-key",
      "4339",
      "2025-2026",
      undefined
    );
    expect((prisma as any).ingestionCheckpoint.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          providerKey_entityType: {
            providerKey: "the_sports_db",
            entityType: "the_sports_db_results:4339:2025-2026"
          }
        }
      })
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        mode: "syncResults",
        plannedCalls: 2,
        attemptedCalls: 2,
        successfulCalls: 2,
        recordsRead: 1,
        recordsWritten: 1,
        halfTimeScoresWritten: 1
      })
    );
    expect((result.details.perLeague as any[])[0]).toEqual(
      expect.objectContaining({
        leagueId: "4339",
        eventsRead: 1,
        matchesWritten: 1,
        halfTimeScoresWritten: 1,
        checkpointBefore: null
      })
    );
  });

  it("uses remaining quota for partial result runs and skips the rest safely", async () => {
    const { service } = createService();
    (service as any).providersService = {
      getProviderRuntimeSettings: jest.fn().mockResolvedValue({
        apiKey: "test-key",
        soccerLeagueIds: ["4339"],
        soccerSeason: "2025-2026",
        soccerBackfillFrom: "2026-01-01",
        dailyLimit: 1
      })
    };
    (service as any).theSportsDbConnector = {
      fetchPastSoccerEvents: jest.fn().mockResolvedValue({ events: [] }),
      fetchSoccerSeasonEvents: jest.fn().mockResolvedValue({ events: [] })
    };

    const result = await (service as any).syncTheSportsDb(
      { id: "provider-1", key: "the_sports_db", baseUrl: null },
      "run-quota",
      "syncResults"
    );

    expect((service as any).theSportsDbConnector.fetchPastSoccerEvents).toHaveBeenCalledTimes(1);
    expect((service as any).theSportsDbConnector.fetchSoccerSeasonEvents).not.toHaveBeenCalled();
    expect(result.details).toEqual(
      expect.objectContaining({
        mode: "syncResults",
        plannedCalls: 2,
        attemptedCalls: 1,
        successfulCalls: 1,
        skippedDueQuota: 1
      })
    );
    expect((result.details.perLeague as any[])[0]).toEqual(
      expect.objectContaining({
        leagueId: "4339",
        attemptedCalls: 1,
        successfulCalls: 1,
        skippedDueQuota: 1
      })
    );
  });
});

describe("ProviderIngestionService SportAPI helpers", () => {
  it("derives half-time score from SportAPI first-half goal events", () => {
    const { service } = createService();

    expect(
      (service as any).deriveSportApiHalfTimeFromEvents(
        [
          { event_type: "goal", team_side: "home", minute: "25'" },
          { event_type: "goal", team_side: "home", minute: "45'+1" },
          { event_type: "goal", team_side: "home", minute: "80'" }
        ],
        "Gaziantep FK",
        "Kayserispor"
      )
    ).toEqual({ home: 2, away: 0, source: "timeline_derived" });
  });

  it("enriches historical SportAPI matches with missing half-time scores", async () => {
    const { service, prisma } = createService();
    (prisma as any).match = {
      findMany: jest
        .fn()
        .mockResolvedValueOnce([
          {
            id: "match-old-missing",
            status: MatchStatus.finished,
            matchDateTimeUTC: new Date("2026-04-10T17:00:00.000Z"),
            homeScore: 3,
            awayScore: 0,
            halfTimeHomeScore: null,
            halfTimeAwayScore: null,
            homeElo: null,
            awayElo: null,
            form5Home: null,
            form5Away: null,
            dataSource: "sportapi_ai",
            league: { id: "league-1", name: "Super Lig" },
            homeTeam: { id: "team-1", name: "Gaziantep FK", country: "TR" },
            awayTeam: { id: "team-2", name: "Kayserispor", country: "TR" },
            providerMappings: [{ providerMatchKey: "7245", mappingConfidence: 0.92 }]
          }
        ])
        .mockResolvedValueOnce([]),
      update: jest.fn().mockResolvedValue({})
    };
    (service as any).providersService = {
      getProviderRuntimeSettings: jest.fn().mockResolvedValue({
        apiKey: "sportapi-key",
        dailyLimit: 1000,
        matchDetailsMaxMatches: 50,
        matchDetailsBackfillDays: 180
      })
    };
    (service as any).sportApiConnector = {
      fetchFixture: jest.fn().mockResolvedValue({
        fixture: {
          id: 7245,
          events: [
            { event_type: "goal", team_side: "home", minute: "25'" },
            { event_type: "goal", team_side: "home", minute: "45'+1" },
            { event_type: "goal", team_side: "home", minute: "80'" }
          ]
        }
      })
    };
    jest.spyOn(service as any, "applyContextPatchToFeatureSnapshot").mockResolvedValue(undefined);

    const result = await (service as any).syncSportApi(
      { id: "provider-sportapi", key: "sportapi_ai", baseUrl: null },
      "run-sportapi-details",
      "enrichMatchDetails"
    );

    expect((prisma as any).match.findMany).toHaveBeenCalledTimes(2);
    expect((prisma as any).match.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "match-old-missing" },
        data: expect.objectContaining({
          halfTimeHomeScore: 2,
          halfTimeAwayScore: 0,
          updatedByProcess: "sportapi_match_details"
        })
      })
    );
    expect(result.details).toEqual(
      expect.objectContaining({
        jobType: "enrichMatchDetails",
        halfTimeScoresWritten: 1,
        timelineHalfTimeScoresWritten: 1,
        backfillDays: 180
      })
    );
  });
});
