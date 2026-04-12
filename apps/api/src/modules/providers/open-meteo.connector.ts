import { Injectable } from "@nestjs/common";

type GeocodeResult = {
  latitude: number;
  longitude: number;
  name: string;
  country?: string;
};

type WeatherPoint = {
  timestamp: string;
  temperatureC: number | null;
  windSpeedKph: number | null;
  precipitationMm: number | null;
};

@Injectable()
export class OpenMeteoConnector {
  private readonly geocodingBase = "https://geocoding-api.open-meteo.com/v1";
  private readonly forecastBase = "https://api.open-meteo.com/v1";
  private readonly archiveBase = "https://archive-api.open-meteo.com/v1";
  private readonly defaultTimeoutMs = 5000;

  private async fetchJson<T>(url: string): Promise<T | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.defaultTimeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "sporx-analytics/1.0"
        }
      });
      if (!response.ok) {
        return null;
      }
      return (await response.json()) as T;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async geocode(name: string, countryCode?: string): Promise<GeocodeResult | null> {
    const params = new URLSearchParams();
    params.set("name", name);
    params.set("count", "1");
    params.set("language", "en");
    params.set("format", "json");
    if (countryCode && countryCode.trim().length > 0) {
      params.set("countryCode", countryCode.trim().slice(0, 2));
    }

    const payload = await this.fetchJson<{ results?: Array<Record<string, unknown>> }>(
      `${this.geocodingBase}/search?${params.toString()}`
    );
    if (!payload) {
      return null;
    }
    const first = payload.results?.[0];
    if (!first) {
      return null;
    }

    const latitude = Number(first.latitude);
    const longitude = Number(first.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return null;
    }

    return {
      latitude,
      longitude,
      name: String(first.name ?? name),
      country: typeof first.country === "string" ? first.country : undefined
    };
  }

  async fetchNearestWeather(
    latitude: number,
    longitude: number,
    kickoffAt: Date
  ): Promise<WeatherPoint | null> {
    const isoDate = kickoffAt.toISOString().slice(0, 10);
    const now = new Date();
    const isPastDate = kickoffAt.getTime() < now.getTime() - 60 * 60 * 1000;

    const params = new URLSearchParams();
    params.set("latitude", String(latitude));
    params.set("longitude", String(longitude));
    params.set("timezone", "UTC");
    params.set("hourly", "temperature_2m,wind_speed_10m,precipitation");
    params.set("start_date", isoDate);
    params.set("end_date", isoDate);

    const base = isPastDate ? this.archiveBase : this.forecastBase;
    const endpoint = isPastDate ? "archive" : "forecast";

    const payload = await this.fetchJson<{
      hourly?: {
        time?: string[];
        temperature_2m?: number[];
        wind_speed_10m?: number[];
        precipitation?: number[];
      };
    }>(`${base}/${endpoint}?${params.toString()}`);
    if (!payload) {
      return null;
    }

    const hourly = payload.hourly;
    if (!hourly?.time || hourly.time.length === 0) {
      return null;
    }

    let bestIndex = 0;
    let bestDelta = Number.POSITIVE_INFINITY;
    for (let i = 0; i < hourly.time.length; i += 1) {
      const ts = new Date(hourly.time[i]).getTime();
      if (!Number.isFinite(ts)) {
        continue;
      }
      const delta = Math.abs(ts - kickoffAt.getTime());
      if (delta < bestDelta) {
        bestDelta = delta;
        bestIndex = i;
      }
    }

    const temperatureRaw = hourly.temperature_2m?.[bestIndex];
    const windRaw = hourly.wind_speed_10m?.[bestIndex];
    const precipitationRaw = hourly.precipitation?.[bestIndex];

    return {
      timestamp: hourly.time[bestIndex],
      temperatureC: Number.isFinite(temperatureRaw as number) ? Number(temperatureRaw) : null,
      windSpeedKph: Number.isFinite(windRaw as number) ? Number(windRaw) : null,
      precipitationMm: Number.isFinite(precipitationRaw as number) ? Number(precipitationRaw) : null
    };
  }
}
