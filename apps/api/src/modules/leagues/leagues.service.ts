import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";

async function queryWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race<T>([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`query_timeout_${timeoutMs}`)), timeoutMs);
    })
  ]);
}

@Injectable()
export class LeaguesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  async list(take?: number) {
    const safeTake = Number.isFinite(take ?? NaN) ? Math.max(50, Math.min(1500, Math.floor(take ?? 0))) : 500;
    const cacheKey = `leagues:list:v2:${safeTake}`;
    const cached = await this.cache.get<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const rows = await queryWithTimeout(
        this.prisma.league.findMany({
          orderBy: [{ name: "asc" }, { id: "asc" }],
          take: safeTake
        }),
        2200
      );
      await this.cache.set(cacheKey, rows, 120, ["leagues"]);
      return rows;
    } catch {
      try {
        const fallbackRows = await queryWithTimeout(
          this.prisma.league.findMany({
            orderBy: { id: "asc" },
            take: safeTake
          }),
          1800
        );
        await this.cache.set(cacheKey, fallbackRows, 60, ["leagues"]);
        return fallbackRows;
      } catch {
        await this.cache.set(cacheKey, [], 20, ["leagues"]);
        return [];
      }
    }
  }

  async getById(id: string) {
    const league = await this.prisma.league.findUnique({ where: { id } });
    if (!league) {
      throw new NotFoundException("League not found");
    }
    return league;
  }

  async getStandings(id: string) {
    const cacheKey = `leagues:standings:v1:${id}`;
    const cached = await this.cache.get<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const standings = await queryWithTimeout(
        this.prisma.standing.findMany({
          where: {
            season: {
              leagueId: id
            }
          },
          include: {
            team: true,
            season: true
          },
          take: 100
        }),
        2500
      );
      await this.cache.set(cacheKey, standings, 120, ["standings", "leagues"]);
      return standings;
    } catch {
      return [];
    }
  }
}