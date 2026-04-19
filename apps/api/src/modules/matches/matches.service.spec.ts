import { MatchStatus } from "@prisma/client";
import { MatchesService } from "./matches.service";

describe("MatchesService", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("exposes half-time score safely in list payload", async () => {
    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "match-1",
            matchDateTimeUTC: new Date("2026-04-18T18:00:00.000Z"),
            status: MatchStatus.live,
            homeScore: 1,
            awayScore: 0,
            halfTimeHomeScore: 1,
            halfTimeAwayScore: 0,
            homeTeamId: "team-1",
            awayTeamId: "team-2",
            leagueId: "league-1"
          }
        ])
      },
      team: {
        findMany: jest.fn().mockResolvedValue([
          { id: "team-1", name: "Ev Takim" },
          { id: "team-2", name: "Deplasman Takim" }
        ])
      },
      league: {
        findMany: jest.fn().mockResolvedValue([{ id: "league-1", name: "Super Lig" }])
      }
    };
    const cache = {
      get: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      set: jest.fn().mockResolvedValue(undefined)
    };
    const service = new MatchesService(prisma as any, cache as any, {} as any);

    const items = await service.list({ status: "live", sport: "football", take: 10 });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "match-1",
      halfTimeScore: { home: 1, away: 0 }
    });
  });

  it("reclassifies future-dated finished rows into live list", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-04-20T00:30:00.000Z"));

    const prisma = {
      match: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: "match-live",
            matchDateTimeUTC: new Date("2026-04-20T01:30:00.000Z"),
            status: MatchStatus.finished,
            homeScore: 1,
            awayScore: 0,
            halfTimeHomeScore: 1,
            halfTimeAwayScore: 0,
            homeTeamId: "team-1",
            awayTeamId: "team-2",
            leagueId: "league-1"
          }
        ])
      },
      team: {
        findMany: jest.fn().mockResolvedValue([
          { id: "team-1", name: "Ev Takim" },
          { id: "team-2", name: "Deplasman Takim" }
        ])
      },
      league: {
        findMany: jest.fn().mockResolvedValue([{ id: "league-1", name: "Super Lig" }])
      }
    };
    const cache = {
      get: jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(null),
      set: jest.fn().mockResolvedValue(undefined)
    };
    const service = new MatchesService(prisma as any, cache as any, {} as any);

    const items = await service.list({ status: "live", sport: "football", take: 10 });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "match-live",
      status: MatchStatus.live,
      score: { home: 1, away: 0 }
    });
  });
});
