import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { FootballDataConnector } from "./football-data.connector";
import { TheSportsDbConnector } from "./the-sports-db.connector";
import { BallDontLieConnector } from "./ball-dont-lie.connector";
import { ApiFootballConnector } from "./api-football.connector";
import { ApiBasketballConnector } from "./api-basketball.connector";
import { ApiNbaConnector } from "./api-nba.connector";
import { SportApiConnector } from "./sport-api.connector";
import { OddsApiIoConnector } from "./odds-api-io.connector";

type ProviderPlan = "free" | "paid" | "local";

type ProviderCatalogEntry = {
  key: string;
  name: string;
  plan: ProviderPlan;
  supportsSports: string[];
  defaultEnabled: boolean;
  requiresApiKey: boolean;
  defaultBaseUrl?: string;
  description: string;
  website: string;
  defaultConfigs?: Record<string, string>;
};

type ProviderRuntimeSettings = {
  apiKey?: string;
  baseUrl?: string;
  competitionCode?: string;
  competitionCodes?: string[];
  priorityCompetitionCodes?: string[];
  minuteRateLimit?: number;
  minuteRateBuffer?: number;
  plannedRequestsPerMinute?: number;
  reserveRequestsPerMinute?: number;
  minIntervalMs?: number;
  maxCallsPerRun?: number;
  retryMax?: number;
  leagueId?: string;
  leagueIds?: string[];
  season?: string;
  soccerLeagueId?: string;
  soccerLeagueIds?: string[];
  basketballLeagueId?: string;
  basketballLeagueIds?: string[];
  soccerSeason?: string;
  soccerBackfillFrom?: string;
  soccerRoundMax?: number;
  soccerRoundStart?: number;
  nbaLeague?: string;
  dailyLimit?: number;
  hourlyLimit?: number;
  syncDaysBack?: number;
  syncDaysAhead?: number;
  standingsLeagueIds?: string[];
  matchDetailsMaxMatches?: number;
  enrichmentEnabled?: boolean;
  oddsSport?: string;
  oddsBookmakers?: string;
  oddsLeague?: string;
  oddsLimit?: number;
};

const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  {
    key: "football_data",
    name: "football-data.org",
    plan: "free",
    supportsSports: ["football"],
    defaultEnabled: true,
    requiresApiKey: true,
    defaultBaseUrl: "https://api.football-data.org/v4",
    description: "Ücretsiz planı olan futbol fikstür ve sonuç API sağlayıcısı.",
    website: "https://www.football-data.org/",
    defaultConfigs: {
      competitionCode: "PL",
      competitionCodes: "WC,CL,BL1,DED,BSA,PD,FL1,ELC,PPL,EC,SA,PL",
      priorityCompetitionCodes: "PL,CL,SA,PD,BL1,FL1",
      minuteRateLimit: "10",
      minuteRateBuffer: "1",
      plannedRequestsPerMinute: "8",
      reserveRequestsPerMinute: "2",
      minIntervalMs: "7000",
      maxCallsPerRun: "12",
      retryMax: "2"
    }
  },
  {
    key: "the_sports_db",
    name: "TheSportsDB",
    plan: "free",
    supportsSports: ["football", "basketball"],
    defaultEnabled: true,
    requiresApiKey: false,
    defaultBaseUrl: "https://www.thesportsdb.com/api/v1/json",
    description: "Geniş spor kapsamı sunan ücretsiz/bağış tabanlı API.",
    website: "https://www.thesportsdb.com/",
    defaultConfigs: {
      apiKey: "123",
      soccerLeagueId: "4339",
      soccerLeagueIds: "4339,4328",
      basketballLeagueId: "4387",
      dailyLimit: "240",
      matchDetailsMaxMatches: "20",
      enrichmentEnabled: "true"
    }
  },
  {
    key: "ball_dont_lie",
    name: "balldontlie",
    plan: "free",
    supportsSports: ["basketball"],
    defaultEnabled: true,
    requiresApiKey: true,
    defaultBaseUrl: "https://api.balldontlie.io/v1",
    description: "Basketbol istatistikleri ve maç bilgileri için ücretsiz API.",
    website: "https://www.balldontlie.io/"
  },
  {
    key: "api_basketball",
    name: "API-BASKETBALL",
    plan: "free",
    supportsSports: ["basketball"],
    defaultEnabled: true,
    requiresApiKey: true,
    defaultBaseUrl: "https://v1.basketball.api-sports.io",
    description: "API-SPORTS basketbol endpointi (günlük limitli).",
    website: "https://www.api-basketball.com/",
    defaultConfigs: {
      dailyLimit: "100"
    }
  },
  {
    key: "api_nba",
    name: "API-NBA",
    plan: "free",
    supportsSports: ["basketball"],
    defaultEnabled: true,
    requiresApiKey: true,
    defaultBaseUrl: "https://v2.nba.api-sports.io",
    description: "API-SPORTS NBA endpointi (günlük limitli).",
    website: "https://www.api-nba.com/",
    defaultConfigs: {
      dailyLimit: "100",
      nbaLeague: "standard",
      season: "2025"
    }
  },
  {
    key: "api_football",
    name: "API-FOOTBALL",
    plan: "free",
    supportsSports: ["football"],
    defaultEnabled: true,
    requiresApiKey: true,
    defaultBaseUrl: "https://v3.football.api-sports.io",
    description: "API-SPORTS futbol endpointi (günlük limitli).",
    website: "https://www.api-football.com/",
    defaultConfigs: {
      dailyLimit: "100",
      leagueIds: "203,204",
      syncDaysBack: "1",
      syncDaysAhead: "1"
    }
  },
  {
    key: "sportapi_ai",
    name: "SportAPI.ai",
    plan: "paid",
    supportsSports: ["football"],
    defaultEnabled: true,
    requiresApiKey: true,
    defaultBaseUrl: "https://sportapi.ai",
    description: "Leagues/fixtures/standings odaklı futbol veri sağlayıcısı.",
    website: "https://sportapi.ai/",
    defaultConfigs: {
      dailyLimit: "1000",
      syncDaysBack: "1",
      syncDaysAhead: "1",
      standingsLeagueIds: "24"
    }
  },
  {
    key: "odds_api_io",
    name: "Odds-API.io",
    plan: "paid",
    supportsSports: ["football", "basketball"],
    defaultEnabled: false,
    requiresApiKey: true,
    defaultBaseUrl: "https://api.odds-api.io/v3",
    description: "Piyasa oran ve hareket verisi sağlayıcısı.",
    website: "https://odds-api.io/",
    defaultConfigs: {
      oddsSport: "football",
      oddsBookmakers: "Bet365,Unibet,SingBet",
      oddsLimit: "60",
      hourlyLimit: "100",
      dailyLimit: "1000"
    }
  },
  {
    key: "historical_csv",
    name: "Historical CSV",
    plan: "local",
    supportsSports: ["football"],
    defaultEnabled: false,
    requiresApiKey: false,
    description: "Yerel historical CSV import sağlayıcısı.",
    website: "local"
  }
];

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly footballDataConnector: FootballDataConnector,
    private readonly theSportsDbConnector: TheSportsDbConnector,
    private readonly ballDontLieConnector: BallDontLieConnector,
    private readonly apiFootballConnector: ApiFootballConnector,
    private readonly apiBasketballConnector: ApiBasketballConnector,
    private readonly apiNbaConnector: ApiNbaConnector,
    private readonly sportApiConnector: SportApiConnector,
    private readonly oddsApiIoConnector: OddsApiIoConnector
  ) {}

  private isSchemaCompatibilityError(error: unknown) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022" || code === "P2010") {
      return true;
    }

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === "P2021" || error.code === "P2022" || error.code === "P2010") {
        return true;
      }
    }

    const message = error instanceof Error ? error.message : String(error ?? "");
    return /relation .* does not exist|table .* does not exist|column .* does not exist|no such table|unknown column/i.test(
      message.toLowerCase()
    );
  }

  private providerCatalogFallbackItem(item: ProviderCatalogEntry) {
    return {
      key: item.key,
      name: item.name,
      isActive: item.defaultEnabled,
      baseUrl: item.defaultBaseUrl ?? null,
      plan: item.plan,
      supportsSports: item.supportsSports,
      requiresApiKey: item.requiresApiKey,
      defaultEnabled: item.defaultEnabled,
      description: item.description,
      website: item.website,
      configs: { ...(item.defaultConfigs ?? {}) }
    };
  }

  private providerMeta(key: string) {
    return PROVIDER_CATALOG.find((item) => item.key === key);
  }

  async ensureProviderCatalog() {
    for (const item of PROVIDER_CATALOG) {
      const provider = await this.prisma.provider.upsert({
        where: { key: item.key },
        update: {
          name: item.name,
          baseUrl: item.defaultBaseUrl ?? undefined
        },
        create: {
          key: item.key,
          name: item.name,
          baseUrl: item.defaultBaseUrl ?? null,
          isActive: item.defaultEnabled
        }
      });

      if (item.defaultConfigs) {
        const configEntries = Object.entries(item.defaultConfigs);
        for (const [configKey, configValue] of configEntries) {
          await this.prisma.providerConfig.upsert({
            where: {
              providerId_configKey: {
                providerId: provider.id,
                configKey
              }
            },
            update: {},
            create: {
              providerId: provider.id,
              configKey,
              configValue
            }
          });
        }
      }
    }
  }

  private configMap(configs: Array<{ configKey: string; configValue: string }>) {
    const map: Record<string, string> = {};
    for (const row of configs) {
      map[row.configKey] = row.configValue;
    }
    return map;
  }

  private envKeyByProvider(providerKey: string) {
    if (providerKey === "football_data") {
      return process.env.FOOTBALL_DATA_API_KEY;
    }
    if (providerKey === "the_sports_db") {
      return process.env.THE_SPORTS_DB_API_KEY;
    }
    if (providerKey === "ball_dont_lie") {
      return process.env.BALL_DONT_LIE_API_KEY;
    }
    if (providerKey === "api_football") {
      return process.env.API_FOOTBALL_API_KEY;
    }
    if (providerKey === "api_basketball") {
      return process.env.API_BASKETBALL_API_KEY;
    }
    if (providerKey === "api_nba") {
      return process.env.API_NBA_API_KEY;
    }
    if (providerKey === "sportapi_ai") {
      return process.env.SPORTAPI_AI_API_KEY;
    }
    if (providerKey === "odds_api_io") {
      return process.env.ODDS_API_IO_API_KEY;
    }
    return undefined;
  }

  private toInt(value: string | undefined) {
    if (!value) {
      return undefined;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    return Math.floor(parsed);
  }

  private toStringList(value: string | undefined) {
    if (!value) {
      return undefined;
    }
    const items = value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    return items.length > 0 ? items : undefined;
  }

  private toBool(value: string | undefined) {
    if (!value) {
      return undefined;
    }
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "off"].includes(normalized)) {
      return false;
    }
    return undefined;
  }

  async getProviderRuntimeSettings(providerKey: string): Promise<ProviderRuntimeSettings> {
    const buildSettingsFromRaw = (configs: Record<string, string>, baseUrl?: string | null): ProviderRuntimeSettings => {
      const apiKey = (configs.apiKey?.trim() || this.envKeyByProvider(providerKey)?.trim() || undefined) as
        | string
        | undefined;

      return {
        apiKey,
        baseUrl: baseUrl ?? undefined,
        competitionCode: configs.competitionCode,
        competitionCodes: this.toStringList(configs.competitionCodes),
        priorityCompetitionCodes: this.toStringList(configs.priorityCompetitionCodes),
        minuteRateLimit: this.toInt(configs.minuteRateLimit),
        minuteRateBuffer: this.toInt(configs.minuteRateBuffer),
        plannedRequestsPerMinute: this.toInt(configs.plannedRequestsPerMinute),
        reserveRequestsPerMinute: this.toInt(configs.reserveRequestsPerMinute),
        minIntervalMs: this.toInt(configs.minIntervalMs),
        maxCallsPerRun: this.toInt(configs.maxCallsPerRun),
        retryMax: this.toInt(configs.retryMax),
        leagueId: configs.leagueId,
        leagueIds: this.toStringList(configs.leagueIds),
        season: configs.season,
        soccerLeagueId: configs.soccerLeagueId,
        soccerLeagueIds: this.toStringList(configs.soccerLeagueIds),
        basketballLeagueId: configs.basketballLeagueId,
        basketballLeagueIds: this.toStringList(configs.basketballLeagueIds),
        soccerSeason: configs.soccerSeason,
        soccerBackfillFrom: configs.soccerBackfillFrom,
        soccerRoundMax: this.toInt(configs.soccerRoundMax),
        soccerRoundStart: this.toInt(configs.soccerRoundStart),
        nbaLeague: configs.nbaLeague,
        dailyLimit: this.toInt(configs.dailyLimit),
        hourlyLimit: this.toInt(configs.hourlyLimit),
        syncDaysBack: this.toInt(configs.syncDaysBack),
        syncDaysAhead: this.toInt(configs.syncDaysAhead),
        standingsLeagueIds: this.toStringList(configs.standingsLeagueIds),
        matchDetailsMaxMatches: this.toInt(configs.matchDetailsMaxMatches),
        enrichmentEnabled: this.toBool(configs.enrichmentEnabled),
        oddsSport: configs.oddsSport,
        oddsBookmakers: configs.oddsBookmakers,
        oddsLeague: configs.oddsLeague,
        oddsLimit: this.toInt(configs.oddsLimit)
      };
    };

    try {
      await this.ensureProviderCatalog();

      const provider = await this.prisma.provider.findUnique({
        where: { key: providerKey },
        include: { configs: true }
      });

      if (!provider) {
        throw new NotFoundException(`Provider not found: ${providerKey}`);
      }

      return buildSettingsFromRaw(this.configMap(provider.configs), provider.baseUrl);
    } catch (error) {
      if (!this.isSchemaCompatibilityError(error)) {
        throw error;
      }

      const meta = this.providerMeta(providerKey);
      if (!meta) {
        throw new NotFoundException(`Provider not found: ${providerKey}`);
      }

      return buildSettingsFromRaw({ ...(meta.defaultConfigs ?? {}) }, meta.defaultBaseUrl ?? null);
    }
  }

  async listProviders() {
    const sortByPlan = (a: { plan: ProviderPlan; key: string }, b: { plan: ProviderPlan; key: string }) => {
      const rank: Record<ProviderPlan, number> = { free: 0, paid: 1, local: 2 };
      const planOrder = rank[a.plan as ProviderPlan] - rank[b.plan as ProviderPlan];
      if (planOrder !== 0) {
        return planOrder;
      }
      return a.key.localeCompare(b.key);
    };

    try {
      await this.ensureProviderCatalog();

      const providers = await this.prisma.provider.findMany({ include: { configs: true }, orderBy: { key: "asc" } });

      return providers
        .map((provider) => {
          const meta = this.providerMeta(provider.key);
          const configs = this.configMap(provider.configs);

          return {
            key: provider.key,
            name: provider.name,
            isActive: provider.isActive,
            baseUrl: provider.baseUrl,
            plan: (meta?.plan ?? "local") as ProviderPlan,
            supportsSports: meta?.supportsSports ?? [],
            requiresApiKey: meta?.requiresApiKey ?? false,
            defaultEnabled: meta?.defaultEnabled ?? false,
            description: meta?.description ?? "",
            website: meta?.website ?? "",
            configs
          };
        })
        .sort(sortByPlan);
    } catch (error) {
      if (!this.isSchemaCompatibilityError(error)) {
        throw error;
      }
      return PROVIDER_CATALOG.map((item) => this.providerCatalogFallbackItem(item)).sort(sortByPlan);
    }
  }

  async updateProvider(key: string, body: { isActive?: boolean; baseUrl?: string | null; name?: string }) {
    await this.ensureProviderCatalog();

    const existing = await this.prisma.provider.findUnique({ where: { key } });
    if (!existing) {
      throw new NotFoundException(`Provider not found: ${key}`);
    }

    const nextData: { isActive?: boolean; baseUrl?: string | null; name?: string } = {};

    if (typeof body.isActive === "boolean") {
      nextData.isActive = body.isActive;
    }

    if (typeof body.name === "string" && body.name.trim().length > 0) {
      nextData.name = body.name.trim();
    }

    if (body.baseUrl !== undefined) {
      const normalized = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
      nextData.baseUrl = normalized.length > 0 ? normalized : null;
    }

    return this.prisma.provider.update({
      where: { key },
      data: nextData
    });
  }

  async getProviderConfigs(key: string) {
    await this.ensureProviderCatalog();

    const provider = await this.prisma.provider.findUnique({
      where: { key },
      include: { configs: true }
    });

    if (!provider) {
      throw new NotFoundException(`Provider not found: ${key}`);
    }

    return {
      key: provider.key,
      baseUrl: provider.baseUrl,
      configs: this.configMap(provider.configs)
    };
  }

  async patchProviderConfigs(key: string, body: { configs: Record<string, string> }) {
    await this.ensureProviderCatalog();

    const provider = await this.prisma.provider.findUnique({ where: { key } });
    if (!provider) {
      throw new NotFoundException(`Provider not found: ${key}`);
    }

    const entries = Object.entries(body.configs ?? {});
    for (const [configKey, configValue] of entries) {
      const normalizedKey = configKey.trim();
      if (normalizedKey.length === 0) {
        continue;
      }
      await this.prisma.providerConfig.upsert({
        where: {
          providerId_configKey: {
            providerId: provider.id,
            configKey: normalizedKey
          }
        },
        update: {
          configValue: String(configValue ?? "")
        },
        create: {
          providerId: provider.id,
          configKey: normalizedKey,
          configValue: String(configValue ?? "")
        }
      });
    }

    return this.getProviderConfigs(key);
  }

  async listActiveApiProviders() {
    try {
      await this.ensureProviderCatalog();
      const providers = await this.prisma.provider.findMany({
        where: { isActive: true, key: { not: "historical_csv" } },
        include: { configs: true }
      });

      return providers.map((provider) => ({
        ...provider,
        configs: this.configMap(provider.configs)
      }));
    } catch (error) {
      if (!this.isSchemaCompatibilityError(error)) {
        throw error;
      }

      return PROVIDER_CATALOG.filter((item) => item.defaultEnabled && item.key !== "historical_csv").map((item) => ({
        id: `catalog:${item.key}`,
        key: item.key,
        name: item.name,
        baseUrl: item.defaultBaseUrl ?? null,
        isActive: true,
        createdAt: new Date(),
        configs: {
          ...(item.defaultConfigs ?? {}),
          ...(this.envKeyByProvider(item.key) ? { apiKey: this.envKeyByProvider(item.key) as string } : {})
        }
      }));
    }
  }

  async providerHealth() {
    let providers: Array<{
      key: string;
      baseUrl: string | null;
      configs: Array<{ configKey: string; configValue: string }>;
    }>;

    try {
      await this.ensureProviderCatalog();
      providers = await this.prisma.provider.findMany({ where: { isActive: true }, include: { configs: true } });
    } catch (error) {
      if (!this.isSchemaCompatibilityError(error)) {
        throw error;
      }
      providers = PROVIDER_CATALOG.filter((item) => item.defaultEnabled).map((item) => ({
        key: item.key,
        baseUrl: item.defaultBaseUrl ?? null,
        configs: Object.entries(item.defaultConfigs ?? {}).map(([configKey, configValue]) => ({
          configKey,
          configValue
        }))
      }));
    }

    const now = new Date().toISOString();

    if (providers.length === 0) {
      return [
        {
          provider: "none",
          status: "degraded",
          latencyMs: 0,
          checkedAt: now,
          message: "No active provider config.",
          plan: "free"
        }
      ];
    }

    const results = [];

    for (const provider of providers) {
      const startedAt = Date.now();
      const configMap = this.configMap(provider.configs);
      const meta = this.providerMeta(provider.key);
      const apiKey = configMap.apiKey?.trim() || this.envKeyByProvider(provider.key)?.trim() || "";

      try {
        if (provider.key === "historical_csv") {
          results.push({
            provider: provider.key,
            status: "healthy",
            latencyMs: 0,
            checkedAt: now,
            message: "Local historical source ready.",
            plan: meta?.plan ?? "local"
          });
          continue;
        }

        if (meta?.requiresApiKey && apiKey.length === 0) {
          results.push({
            provider: provider.key,
            status: "degraded",
            latencyMs: 0,
            checkedAt: now,
            message: "API key eksik.",
            plan: meta?.plan ?? "free"
          });
          continue;
        }

        let health: { ok: boolean; status: number } = { ok: true, status: 200 };
        if (provider.key === "football_data") {
          health = await this.footballDataConnector.ping(apiKey, provider.baseUrl ?? undefined);
        } else if (provider.key === "the_sports_db") {
          health = await this.theSportsDbConnector.ping(apiKey, provider.baseUrl ?? undefined);
        } else if (provider.key === "ball_dont_lie") {
          health = await this.ballDontLieConnector.ping(apiKey, provider.baseUrl ?? undefined);
        } else if (provider.key === "api_football") {
          health = await this.apiFootballConnector.ping(apiKey, provider.baseUrl ?? undefined);
        } else if (provider.key === "api_basketball") {
          health = await this.apiBasketballConnector.ping(apiKey, provider.baseUrl ?? undefined);
        } else if (provider.key === "api_nba") {
          health = await this.apiNbaConnector.ping(apiKey, provider.baseUrl ?? undefined);
        } else if (provider.key === "sportapi_ai") {
          health = await this.sportApiConnector.ping(apiKey, provider.baseUrl ?? undefined);
        } else if (provider.key === "odds_api_io") {
          health = await this.oddsApiIoConnector.ping(apiKey, provider.baseUrl ?? undefined);
        }

        const latencyMs = Date.now() - startedAt;
        results.push({
          provider: provider.key,
          status: health.ok ? "healthy" : "degraded",
          latencyMs,
          checkedAt: now,
          message: health.ok ? "Heartbeat OK" : `HTTP ${health.status}`,
          plan: meta?.plan ?? "free"
        });
      } catch (error) {
        const latencyMs = Date.now() - startedAt;
        const message = error instanceof Error ? error.message : "Provider health check failed";
        results.push({
          provider: provider.key,
          status: "down",
          latencyMs,
          checkedAt: now,
          message,
          plan: meta?.plan ?? "free"
        });
      }
    }

    return results;
  }
}
