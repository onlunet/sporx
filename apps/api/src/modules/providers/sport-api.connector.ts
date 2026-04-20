import { Injectable } from "@nestjs/common";

type SportApiLeagueGroup = {
  country?: string;
  geo?: string;
  leagues?: Array<Record<string, unknown>>;
};

@Injectable()
export class SportApiConnector {
  private readonly defaultBaseUrl = "https://sportapi.ai";
  private readonly timeoutMs = this.numberFromEnv("PROVIDER_HTTP_TIMEOUT_MS", 12000);
  private readonly retryCount = this.numberFromEnv("PROVIDER_HTTP_RETRIES", 1);

  private headers(apiKey: string) {
    return {
      "x-api-key": apiKey,
      "User-Agent": "sporx-analytics/1.0"
    };
  }

  private resolveBaseUrl(baseUrl?: string) {
    const resolved = baseUrl?.trim();
    return resolved && resolved.length > 0 ? resolved.replace(/\/$/, "") : this.defaultBaseUrl;
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
    const response = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/api/leagues`,
      {
        headers: this.headers(apiKey)
      },
      "sportapi_ai ping"
    );
    return { ok: response.ok, status: response.status };
  }

  async fetchFixturesByDate(apiKey: string, date: string, baseUrl?: string) {
    const response = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/api/fixtures/date/${date}`,
      {
        headers: this.headers(apiKey)
      },
      "sportapi_ai fixtures by date"
    );

    if (!response.ok) {
      throw new Error(`sportapi_ai fixtures failed: ${response.status}`);
    }

    return (await response.json()) as {
      success?: boolean;
      date?: string;
      data?: Array<Record<string, unknown>>;
    };
  }

  async fetchFixture(apiKey: string, fixtureId: string, baseUrl?: string) {
    const response = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/api/fixtures/${fixtureId}`,
      {
        headers: this.headers(apiKey)
      },
      "sportapi_ai fixture"
    );

    if (!response.ok) {
      throw new Error(`sportapi_ai fixture failed: ${response.status}`);
    }

    return (await response.json()) as {
      success?: boolean;
      fixture?: Record<string, unknown>;
      data?: Record<string, unknown>;
    };
  }

  async fetchLeagues(apiKey: string, baseUrl?: string) {
    const response = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/api/leagues`,
      {
        headers: this.headers(apiKey)
      },
      "sportapi_ai leagues"
    );

    if (!response.ok) {
      throw new Error(`sportapi_ai leagues failed: ${response.status}`);
    }

    return (await response.json()) as {
      success?: boolean;
      data?: SportApiLeagueGroup[];
    };
  }

  async fetchStandings(apiKey: string, leagueId: string, baseUrl?: string) {
    const response = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/api/standings/${leagueId}`,
      {
        headers: this.headers(apiKey)
      },
      "sportapi_ai standings"
    );

    if (!response.ok) {
      throw new Error(`sportapi_ai standings failed: ${response.status}`);
    }

    return (await response.json()) as {
      success?: boolean;
      data?: Array<Record<string, unknown>>;
    };
  }
}
