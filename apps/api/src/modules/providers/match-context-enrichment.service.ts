import { Injectable, Logger } from "@nestjs/common";
import { createHash } from "node:crypto";
import { Prisma, MatchStatus } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { CacheService } from "../../cache/cache.service";
import { OpenMeteoConnector } from "./open-meteo.connector";
import { resolveFootballPredictionHorizon } from "../predictions/prediction-horizon.util";

type UpsertContextInput = {
  matchId: string;
  kickoffAt: Date;
  sportCode: "football" | "basketball";
  leagueName?: string | null;
  homeTeamName: string;
  awayTeamName: string;
  homeTeamCountry: string;
  awayTeamCountry: string;
  status: MatchStatus;
  homeScore: number | null;
  awayScore: number | null;
  homeElo?: number | null;
  awayElo?: number | null;
  form5Home?: number | null;
  form5Away?: number | null;
  refereeName?: string | null;
  source: string;
};

@Injectable()
export class MatchContextEnrichmentService {
  private readonly logger = new Logger(MatchContextEnrichmentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly openMeteo: OpenMeteoConnector
  ) {}

  private hashScore(value: string, min: number, max: number) {
    if (!value || value.trim().length === 0) {
      return null;
    }

    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) % 10000;
    }
    const normalized = hash / 10000;
    return Number((min + (max - min) * normalized).toFixed(3));
  }

  private hashPayload(payload: unknown) {
    return createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex");
  }

  private async writeFeatureSnapshotV2(input: UpsertContextInput, features: Record<string, unknown>) {
    const now = new Date();
    const hasLineup = typeof features.lineupCertaintyScore === "number" && Number(features.lineupCertaintyScore) >= 0.55;
    const horizon = resolveFootballPredictionHorizon({
      status: input.status,
      kickoffAt: input.kickoffAt,
      now,
      hasLineup
    });
    const cutoffAt = input.status === MatchStatus.scheduled && input.kickoffAt.getTime() > now.getTime() ? now : input.kickoffAt;
    const featureHash = this.hashPayload(features);

    try {
      await this.prisma.featureSnapshot.create({
        data: {
          matchId: input.matchId,
          horizon,
          featureSetVersion: "context_enrichment_v1",
          cutoffAt,
          generatedAt: now,
          featureHash,
          featuresJson: features as Prisma.InputJsonValue
        }
      });
    } catch {
      // Backward-compatible fallback when v2 pipeline tables are not present yet.
    }
  }

  private toRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private teamRatingSeed(name: string, country: string, isHome: boolean) {
    const token = `${name}:${country}`.toLowerCase();
    let hash = 0;
    for (let i = 0; i < token.length; i += 1) {
      hash = (hash * 31 + token.charCodeAt(i)) % 100000;
    }
    const base = 1450 + (hash % 220);
    return base;
  }

  private formSeed(name: string, country: string) {
    const token = `form:${name}:${country}`.toLowerCase();
    const score = this.hashScore(token, 0.8, 1.35);
    return score ?? 1;
  }

  private compactTeamName(value: string) {
    return value
      .replace(/\b(fc|cf|afc|sc|ac|club|deportivo|atletico|athletic|bk|fk)\b/gi, " ")
      .replace(/[^a-z0-9\s]/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private resolveWeatherImpact(weather: { precipitationMm: number | null; windSpeedKph: number | null; temperatureC: number | null } | null) {
    if (!weather) {
      return null;
    }

    const precipitation = weather.precipitationMm ?? 0;
    const wind = weather.windSpeedKph ?? 0;
    const temperature = weather.temperatureC ?? 15;

    const precipImpact = Math.min(0.45, precipitation * 0.08);
    const windImpact = Math.min(0.35, Math.max(0, wind - 12) * 0.015);
    const tempImpact = temperature < 0 ? 0.12 : temperature > 30 ? 0.1 : 0;
    return Number(Math.min(1, precipImpact + windImpact + tempImpact).toFixed(3));
  }

  private baseLambda(input: UpsertContextInput) {
    const homeElo = input.homeElo ?? this.teamRatingSeed(input.homeTeamName, input.homeTeamCountry, true);
    const awayElo = input.awayElo ?? this.teamRatingSeed(input.awayTeamName, input.awayTeamCountry, false);
    const homeForm = input.form5Home ?? this.formSeed(input.homeTeamName, input.homeTeamCountry);
    const awayForm = input.form5Away ?? this.formSeed(input.awayTeamName, input.awayTeamCountry);
    const eloDelta = homeElo - awayElo;
    const formDelta = homeForm - awayForm;

    const expectedHomeGoalsBase = Number(Math.max(0.35, 1.16 + eloDelta / 980 + formDelta * 0.16).toFixed(3));
    const expectedAwayGoalsBase = Number(Math.max(0.35, 1.14 - eloDelta / 980 - formDelta * 0.14).toFixed(3));

    return { expectedHomeGoalsBase, expectedAwayGoalsBase };
  }

  private normalizeCountryToIso2(value: string): string | undefined {
    if (!value || value.trim().length === 0) {
      return undefined;
    }

    const token = value.trim().toUpperCase();
    if (token.length === 2) {
      return token;
    }
    if (token.length === 3) {
      const mapping: Record<string, string> = {
        ENG: "GB",
        GBR: "GB",
        ESP: "ES",
        FRA: "FR",
        DEU: "DE",
        GER: "DE",
        ITA: "IT",
        TUR: "TR",
        NLD: "NL",
        BEL: "BE",
        PRT: "PT",
        USA: "US"
      };
      return mapping[token];
    }
    return undefined;
  }

  private async getWeatherForMatch(input: UpsertContextInput) {
    if (input.sportCode !== "football") {
      return null;
    }

    const weatherCacheKey = `weather:${input.homeTeamName}:${input.homeTeamCountry}:${input.kickoffAt.toISOString().slice(0, 10)}`;
    const cachedWeather = await this.cache.get<{
      timestamp: string;
      temperatureC: number | null;
      windSpeedKph: number | null;
      precipitationMm: number | null;
      locationName: string;
    }>(weatherCacheKey);
    if (cachedWeather) {
      return cachedWeather;
    }

    const geocodeCacheKey = `geo:${input.homeTeamName}:${input.homeTeamCountry}`;
    const cachedGeo = await this.cache.get<{ latitude: number; longitude: number; name: string }>(geocodeCacheKey);
    let location = cachedGeo;

    if (!location) {
      const iso2 = this.normalizeCountryToIso2(input.homeTeamCountry);
      const candidates = [
        input.homeTeamName,
        this.compactTeamName(input.homeTeamName),
        `${this.compactTeamName(input.homeTeamName)} ${input.homeTeamCountry}`
      ].filter((item, index, self) => item.length > 0 && self.indexOf(item) === index);

      let resolved: { latitude: number; longitude: number; name: string } | null = null;
      for (const candidate of candidates) {
        const geo = await this.openMeteo.geocode(candidate, iso2);
        if (geo) {
          resolved = geo;
          break;
        }
      }
      if (!resolved) {
        return null;
      }
      location = { latitude: resolved.latitude, longitude: resolved.longitude, name: resolved.name };
      await this.cache.set(geocodeCacheKey, location, 60 * 60 * 24 * 7, ["weather"]);
    }

    const weather = await this.openMeteo.fetchNearestWeather(location.latitude, location.longitude, input.kickoffAt);
    if (!weather) {
      return null;
    }

    const payload = {
      ...weather,
      locationName: location.name
    };
    await this.cache.set(weatherCacheKey, payload, 60 * 60 * 6, ["weather"]);
    return payload;
  }

  private resolveRefereeProfile(input: UpsertContextInput, existingFeatures: Record<string, unknown> | null) {
    const incomingRefereeName = typeof input.refereeName === "string" ? input.refereeName.trim() : "";
    if (incomingRefereeName.length > 0) {
      return {
        refereeName: incomingRefereeName,
        refereeSource: "provider_official",
        refereeStrictnessScore: this.hashScore(incomingRefereeName, 0.35, 0.92)
      } as const;
    }

    const existingRefereeNameRaw = existingFeatures?.refereeName;
    const existingRefereeName = typeof existingRefereeNameRaw === "string" ? existingRefereeNameRaw.trim() : "";
    const existingRefereeSourceRaw = existingFeatures?.refereeSource;
    const existingRefereeSource = typeof existingRefereeSourceRaw === "string" ? existingRefereeSourceRaw.trim().toLowerCase() : "";

    if (existingRefereeName.length > 0 && existingRefereeSource === "provider_official") {
      return {
        refereeName: existingRefereeName,
        refereeSource: "provider_official",
        refereeStrictnessScore: this.hashScore(existingRefereeName, 0.35, 0.92)
      } as const;
    }

    const fallbackToken = `${input.leagueName ?? "league"}|${input.homeTeamName}|${input.awayTeamName}`;
    return {
      refereeName: null,
      refereeSource: "heuristic_fallback",
      refereeStrictnessScore: this.hashScore(fallbackToken, 0.45, 0.78)
    } as const;
  }

  async upsertContext(input: UpsertContextInput) {
    try {
      const featureSet = await this.prisma.featureSet.upsert({
        where: {
          name_version: {
            name: "context_enrichment",
            version: "v1"
          }
        },
        update: {
          active: true
        },
        create: {
          name: "context_enrichment",
          version: "v1",
          definition: {
            description: "Free-source referee/weather/proxy-xg context snapshot"
          } as Prisma.InputJsonValue,
          active: true
        }
      });

      const existingSnapshot = await this.prisma.matchFeatureSnapshot.findUnique({
        where: {
          matchId_featureSetId: {
            matchId: input.matchId,
            featureSetId: featureSet.id
          }
        },
        select: {
          features: true
        }
      });

      const existingFeatures = this.toRecord(existingSnapshot?.features ?? null);
      const weather = await this.getWeatherForMatch(input);
      const weatherImpactScore = this.resolveWeatherImpact(weather);
      const refereeProfile = this.resolveRefereeProfile(input, existingFeatures);
      const refereeStrictnessScore = refereeProfile.refereeStrictnessScore;

      const lineupCertaintyScore =
        input.status === MatchStatus.finished
          ? 0.95
          : input.status === MatchStatus.live
            ? 0.85
            : 0.62;

      const fatigueScore = this.hashScore(`${input.homeTeamName}|${input.awayTeamName}|${input.kickoffAt.toISOString().slice(0, 10)}`, 0.25, 0.82) ?? 0.5;
      const contextPressureScore = this.hashScore(`${input.homeTeamName}|${input.awayTeamName}`, 0.3, 0.88) ?? 0.5;

      const lambda = this.baseLambda(input);
      const weatherPenalty = weatherImpactScore ? 1 - Math.min(weatherImpactScore * 0.35, 0.25) : 1;
      const adjustedLambdaHome = Number((lambda.expectedHomeGoalsBase * weatherPenalty).toFixed(3));
      const adjustedLambdaAway = Number((lambda.expectedAwayGoalsBase * weatherPenalty).toFixed(3));
      const lowScoreBias = Number(
        Math.min(0.35, Math.max(0, (weatherImpactScore ?? 0) * 0.45 + (refereeStrictnessScore ?? 0) * 0.08)).toFixed(3)
      );
      const highScoreBias = Number(Math.max(0.05, 0.22 - lowScoreBias / 2).toFixed(3));

      const features = {
        source: input.source,
        refereeName: refereeProfile.refereeName,
        refereeSource: refereeProfile.refereeSource,
        refereeStrictnessScore,
        lineupCertaintyScore,
        scheduleFatigueScore: fatigueScore,
        contextPressureScore,
        leagueGoalEnvironment: null,
        weatherImpactScore,
        xgSource: "proxy_elo_form_weather",
        dataCompleteness: {
          weather: weather ? "filled" : "missing",
          referee: refereeProfile.refereeName ? "filled" : "estimated",
          xg: "proxy"
        },
        weather: weather
          ? {
              location: weather.locationName,
              timestamp: weather.timestamp,
              temperatureC: weather.temperatureC,
              windSpeedKph: weather.windSpeedKph,
              precipitationMm: weather.precipitationMm
            }
          : null,
        expectedHomeGoalsBase: lambda.expectedHomeGoalsBase,
        expectedAwayGoalsBase: lambda.expectedAwayGoalsBase,
        adjustedLambdaHome,
        adjustedLambdaAway,
        lowScoreBias,
        highScoreBias
      };

      await this.prisma.matchFeatureSnapshot.upsert({
        where: {
          matchId_featureSetId: {
            matchId: input.matchId,
            featureSetId: featureSet.id
          }
        },
        update: {
          features: features as Prisma.InputJsonValue,
          generatedAt: new Date()
        },
        create: {
          matchId: input.matchId,
          featureSetId: featureSet.id,
          features: features as Prisma.InputJsonValue
        }
      });

      await this.writeFeatureSnapshotV2(input, features);

      return features;
    } catch (error) {
      this.logger.warn(
        `Context enrichment failed for match ${input.matchId}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      return null;
    }
  }
}
