import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { PrismaService } from "../../prisma/prisma.service";
import { OddsApiIoConnector } from "../providers/odds-api-io.connector";
import { OddsService } from "./odds.service";

@Controller("admin/odds")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminOddsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly oddsService: OddsService,
    private readonly oddsConnector: OddsApiIoConnector
  ) {}

  @Get("providers")
  async providers() {
    const providers = await this.prisma.provider.findMany({
      where: { key: { in: ["odds_api_io"] } },
      include: { configs: true },
      orderBy: { key: "asc" }
    });

    return providers.map((provider) => ({
      key: provider.key,
      name: provider.name,
      isActive: provider.isActive,
      baseUrl: provider.baseUrl,
      configs: Object.fromEntries(provider.configs.map((config) => [config.configKey, config.configValue]))
    }));
  }

  @Get("health")
  async health() {
    const providers = await this.prisma.provider.findMany({
      where: { key: { in: ["odds_api_io"] } },
      include: { configs: true }
    });

    const now = new Date().toISOString();
    const results = [];
    for (const provider of providers) {
      const config = Object.fromEntries(provider.configs.map((item) => [item.configKey, item.configValue]));
      const apiKey =
        (typeof config.apiKey === "string" && config.apiKey.trim().length > 0 ? config.apiKey : process.env.ODDS_API_IO_API_KEY) ??
        "";
      if (!apiKey) {
        results.push({
          provider: provider.key,
          status: "degraded",
          latencyMs: 0,
          checkedAt: now,
          message: "ODDS_API_IO_API_KEY eksik."
        });
        continue;
      }

      const startedAt = Date.now();
      try {
        const health = await this.oddsConnector.ping(apiKey, provider.baseUrl ?? undefined);
        results.push({
          provider: provider.key,
          status: health.ok ? "healthy" : "degraded",
          latencyMs: Date.now() - startedAt,
          checkedAt: now,
          message: health.ok ? "Heartbeat OK" : `HTTP ${health.status}`
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        results.push({
          provider: provider.key,
          status: "down",
          latencyMs: Date.now() - startedAt,
          checkedAt: now,
          message
        });
      }
    }

    return results;
  }

  @Get("snapshots")
  snapshots(
    @Query("matchId") matchId?: string,
    @Query("marketType") marketType?: string,
    @Query("line") line?: string,
    @Query("limit") limit?: string
  ) {
    const parsedLine = line === undefined ? undefined : Number(line);
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    return this.oddsService.listSnapshots({
      matchId,
      marketType,
      line: Number.isFinite(parsedLine) ? parsedLine : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined
    });
  }

  @Get("market-analysis")
  marketAnalysis(
    @Query("matchId") matchId?: string,
    @Query("predictionType") predictionType?: string,
    @Query("line") line?: string,
    @Query("limit") limit?: string
  ) {
    const parsedLine = line === undefined ? undefined : Number(line);
    const parsedLimit = limit === undefined ? undefined : Number(limit);
    return this.oddsService.listMarketAnalysis({
      matchId,
      predictionType,
      line: Number.isFinite(parsedLine) ? parsedLine : undefined,
      limit: Number.isFinite(parsedLimit) ? parsedLimit : undefined
    });
  }

  @Get("disagreements")
  disagreements(@Query("threshold") threshold?: string, @Query("limit") limit?: string) {
    const parsedThreshold = Number(threshold);
    const parsedLimit = Number(limit);
    return this.oddsService.listDisagreements(
      Number.isFinite(parsedThreshold) ? parsedThreshold : 0.12,
      Number.isFinite(parsedLimit) ? parsedLimit : 200
    );
  }
}
