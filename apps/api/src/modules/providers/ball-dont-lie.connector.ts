import { Injectable } from "@nestjs/common";

@Injectable()
export class BallDontLieConnector {
  private readonly defaultBaseUrl = "https://api.balldontlie.io/v1";
  private readonly timeoutMs = this.numberFromEnv("PROVIDER_HTTP_TIMEOUT_MS", 12000);
  private readonly retryCount = this.numberFromEnv("PROVIDER_HTTP_RETRIES", 1);

  private headers(apiKey?: string) {
    const headers: Record<string, string> = {
      "User-Agent": "sporx-analytics/1.0"
    };
    const token = apiKey?.trim();
    if (token && token.length > 0) {
      headers.Authorization = token;
    }
    return headers;
  }

  private resolveBaseUrl(baseUrl?: string) {
    const resolved = baseUrl?.trim();
    return resolved && resolved.length > 0 ? resolved : this.defaultBaseUrl;
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

  async ping(apiKey?: string, baseUrl?: string) {
    const response = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/teams?per_page=1`,
      {
        headers: this.headers(apiKey)
      },
      "ball_dont_lie ping"
    );
    return { ok: response.ok, status: response.status };
  }

  async fetchGames(startDate: string, endDate: string, apiKey?: string, baseUrl?: string) {
    const query = new URLSearchParams({
      start_date: startDate,
      end_date: endDate,
      per_page: "100"
    });

    const response = await this.request(
      `${this.resolveBaseUrl(baseUrl)}/games?${query.toString()}`,
      {
        headers: this.headers(apiKey)
      },
      "ball_dont_lie games"
    );

    if (!response.ok) {
      throw new Error(`ball_dont_lie games failed: ${response.status}`);
    }

    return (await response.json()) as { data?: Array<Record<string, unknown>> };
  }
}
