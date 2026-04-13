import { Injectable } from "@nestjs/common";

type FetchEventsOptions = {
  sport: string;
  status?: string;
  from?: string;
  to?: string;
  league?: string;
  limit?: number;
  bookmaker?: string;
};

@Injectable()
export class OddsApiIoConnector {
  private readonly defaultBaseUrl = "https://api.odds-api.io/v3";
  private readonly timeoutMs = this.numberFromEnv("PROVIDER_HTTP_TIMEOUT_MS", 12000);
  private readonly retryCount = this.numberFromEnv("PROVIDER_HTTP_RETRIES", 1);

  private numberFromEnv(key: string, fallback: number) {
    const raw = process.env[key];
    if (!raw) {
      return fallback;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return fallback;
    }
    return Math.floor(parsed);
  }

  private resolveBaseUrl(baseUrl?: string) {
    const resolved = baseUrl?.trim();
    return resolved && resolved.length > 0 ? resolved : this.defaultBaseUrl;
  }

  private async request(url: string, context: string) {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await fetch(url, { signal: controller.signal });
      } catch (error) {
        if (error instanceof Error) {
          lastError = error;
        }
        if (attempt < this.retryCount) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`${context} request failed: ${lastError?.message ?? "unknown error"}`);
  }

  private withApiKey(url: URL, apiKey: string) {
    url.searchParams.set("apiKey", apiKey);
    return url.toString();
  }

  async ping(apiKey: string, baseUrl?: string) {
    const url = new URL("/sports", this.resolveBaseUrl(baseUrl));
    const response = await this.request(this.withApiKey(url, apiKey), "odds_api_io ping");
    return { ok: response.ok, status: response.status };
  }

  async fetchEvents(apiKey: string, options: FetchEventsOptions, baseUrl?: string) {
    const url = new URL("/events", this.resolveBaseUrl(baseUrl));
    url.searchParams.set("sport", options.sport);
    if (options.status) url.searchParams.set("status", options.status);
    if (options.from) url.searchParams.set("from", options.from);
    if (options.to) url.searchParams.set("to", options.to);
    if (options.league) url.searchParams.set("league", options.league);
    if (options.limit && options.limit > 0) url.searchParams.set("limit", String(Math.min(options.limit, 100)));
    if (options.bookmaker) url.searchParams.set("bookmaker", options.bookmaker);

    const response = await this.request(this.withApiKey(url, apiKey), "odds_api_io events");
    if (!response.ok) {
      throw new Error(`odds_api_io events failed: ${response.status}`);
    }
    return (await response.json()) as Array<Record<string, unknown>>;
  }

  async fetchLiveEvents(apiKey: string, sport: string, baseUrl?: string) {
    const url = new URL("/events/live", this.resolveBaseUrl(baseUrl));
    url.searchParams.set("sport", sport);
    const response = await this.request(this.withApiKey(url, apiKey), "odds_api_io live events");
    if (!response.ok) {
      throw new Error(`odds_api_io live events failed: ${response.status}`);
    }
    return (await response.json()) as Array<Record<string, unknown>>;
  }

  async fetchOdds(apiKey: string, eventId: string, bookmakers: string, baseUrl?: string) {
    const url = new URL("/odds", this.resolveBaseUrl(baseUrl));
    url.searchParams.set("eventId", eventId);
    url.searchParams.set("bookmakers", bookmakers);
    const response = await this.request(this.withApiKey(url, apiKey), "odds_api_io odds");
    if (!response.ok) {
      throw new Error(`odds_api_io odds failed: ${response.status}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }

  async fetchMultiOdds(apiKey: string, eventIds: string[], bookmakers: string, baseUrl?: string) {
    const url = new URL("/odds/multi", this.resolveBaseUrl(baseUrl));
    url.searchParams.set("eventIds", eventIds.join(","));
    url.searchParams.set("bookmakers", bookmakers);
    const response = await this.request(this.withApiKey(url, apiKey), "odds_api_io odds multi");
    if (!response.ok) {
      throw new Error(`odds_api_io odds multi failed: ${response.status}`);
    }
    const json = (await response.json()) as unknown;
    if (Array.isArray(json)) {
      return json as Array<Record<string, unknown>>;
    }
    const record = json && typeof json === "object" ? (json as Record<string, unknown>) : null;
    if (record && Array.isArray(record.data)) {
      return record.data.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"));
    }
    return [];
  }
}
