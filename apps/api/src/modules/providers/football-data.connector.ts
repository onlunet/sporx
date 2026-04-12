import { Injectable } from "@nestjs/common";

export class FootballDataHttpError extends Error {
  readonly status: number;
  readonly retryAfterSeconds?: number;

  constructor(message: string, status: number, retryAfterSeconds?: number) {
    super(message);
    this.name = "FootballDataHttpError";
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

@Injectable()
export class FootballDataConnector {
  private readonly defaultBaseUrl = "https://api.football-data.org/v4";
  private readonly timeoutMs = this.numberFromEnv("PROVIDER_HTTP_TIMEOUT_MS", 12000);
  private readonly retryCount = this.numberFromEnv("PROVIDER_HTTP_RETRIES", 1);

  private headers(apiKey: string) {
    return {
      "X-Auth-Token": apiKey,
      "User-Agent": "sporx-analytics/1.0"
    };
  }

  private resolveBaseUrl(baseUrl?: string) {
    const resolved = baseUrl?.trim();
    return resolved && resolved.length > 0 ? resolved : this.defaultBaseUrl;
  }

  private parseRetryAfterSeconds(headerValue: string | null) {
    if (!headerValue) {
      return undefined;
    }
    const numeric = Number(headerValue);
    if (Number.isFinite(numeric) && numeric >= 0) {
      return Math.floor(numeric);
    }
    const dateMs = Date.parse(headerValue);
    if (Number.isNaN(dateMs)) {
      return undefined;
    }
    const diffSeconds = Math.ceil((dateMs - Date.now()) / 1000);
    return diffSeconds > 0 ? diffSeconds : undefined;
  }

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

  private async request(url: string, init: RequestInit, context: string) {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        return await fetch(url, {
          ...init,
          signal: controller.signal
        });
      } catch (error) {
        if (error instanceof Error) {
          lastError = error;
        }
        if (attempt < this.retryCount) {
          await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(`${context} request failed: ${lastError?.message ?? "unknown error"}`);
  }

  async ping(apiKey: string, baseUrl?: string) {
    const res = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/competitions`,
      { headers: this.headers(apiKey) },
      "football_data ping"
    );
    return { ok: res.ok, status: res.status };
  }

  async fetchCompetitions(apiKey: string, baseUrl?: string) {
    const res = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/competitions`,
      { headers: this.headers(apiKey) },
      "football_data competitions"
    );
    if (!res.ok) {
      throw new FootballDataHttpError(
        `football_data competitions failed: ${res.status}`,
        res.status,
        this.parseRetryAfterSeconds(res.headers.get("retry-after"))
      );
    }
    return (await res.json()) as { competitions?: Array<Record<string, unknown>> };
  }

  async fetchMatches(apiKey: string, competitionCode: string, dateFrom?: string, dateTo?: string, baseUrl?: string) {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);

    const query = params.toString();
    const suffix = query.length > 0 ? `?${query}` : "";
    const res = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/competitions/${competitionCode}/matches${suffix}`,
      {
        headers: this.headers(apiKey)
      },
      "football_data matches"
    );

    if (!res.ok) {
      throw new FootballDataHttpError(
        `football_data matches failed: ${res.status}`,
        res.status,
        this.parseRetryAfterSeconds(res.headers.get("retry-after"))
      );
    }

    return (await res.json()) as { matches?: Array<Record<string, unknown>> };
  }

  async fetchStandings(
    apiKey: string,
    competitionCode: string,
    season?: string,
    baseUrl?: string
  ) {
    const params = new URLSearchParams();
    if (season && season.trim().length > 0) {
      params.set("season", season.trim());
    }

    const query = params.toString();
    const suffix = query.length > 0 ? `?${query}` : "";
    const res = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/competitions/${competitionCode}/standings${suffix}`,
      {
        headers: this.headers(apiKey)
      },
      "football_data standings"
    );

    if (!res.ok) {
      throw new FootballDataHttpError(
        `football_data standings failed: ${res.status}`,
        res.status,
        this.parseRetryAfterSeconds(res.headers.get("retry-after"))
      );
    }

    return (await res.json()) as Record<string, unknown>;
  }
}
