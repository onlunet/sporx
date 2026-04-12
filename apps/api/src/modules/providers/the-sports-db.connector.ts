import { Injectable } from "@nestjs/common";

@Injectable()
export class TheSportsDbConnector {
  private readonly defaultBaseUrl = "https://www.thesportsdb.com/api/v1/json";
  private readonly timeoutMs = this.numberFromEnv("PROVIDER_HTTP_TIMEOUT_MS", 12000);
  private readonly retryCount = this.numberFromEnv("PROVIDER_HTTP_RETRIES", 1);

  private resolveApiKey(apiKey?: string) {
    const value = apiKey?.trim();
    return value && value.length > 0 ? value : "3";
  }

  private buildUrl(path: string, apiKey?: string, baseUrl?: string) {
    const root = (baseUrl?.trim() || this.defaultBaseUrl).replace(/\/$/, "");
    return `${root}/${this.resolveApiKey(apiKey)}${path}`;
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

  private async request(url: string, context: string) {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.retryCount; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        return await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent": "sporx-analytics/1.0"
          }
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

  private async requestJson<T>(url: string, context: string) {
    const response = await this.request(url, context);
    if (!response.ok) {
      throw new Error(`${context} failed: ${response.status}`);
    }
    return (await response.json()) as T;
  }

  async ping(apiKey?: string, baseUrl?: string) {
    const response = await this.request(this.buildUrl("/all_sports.php", apiKey, baseUrl), "the_sports_db ping");
    return { ok: response.ok, status: response.status };
  }

  async fetchUpcomingSoccerEvents(apiKey?: string, leagueId = "4328", baseUrl?: string) {
    return this.requestJson<{ events?: Array<Record<string, unknown>> }>(
      this.buildUrl(`/eventsnextleague.php?id=${leagueId}`, apiKey, baseUrl),
      "the_sports_db soccer events"
    );
  }

  async fetchSoccerRoundEvents(apiKey: string | undefined, leagueId: string, season: string, round: number, baseUrl?: string) {
    return this.requestJson<{ events?: Array<Record<string, unknown>> }>(
      this.buildUrl(`/eventsround.php?id=${leagueId}&r=${round}&s=${season}`, apiKey, baseUrl),
      "the_sports_db soccer round events"
    );
  }

  async fetchUpcomingBasketballEvents(apiKey?: string, leagueId = "4387", baseUrl?: string) {
    const currentYear = new Date().getUTCFullYear();
    const month = new Date().getUTCMonth() + 1;
    const season = month >= 9 ? `${currentYear}-${currentYear + 1}` : `${currentYear - 1}-${currentYear}`;
    return this.requestJson<{ events?: Array<Record<string, unknown>> }>(
      this.buildUrl(`/eventsseason.php?id=${leagueId}&s=${season}`, apiKey, baseUrl),
      "the_sports_db basketball events"
    );
  }

  async fetchAllTeamsByLeague(apiKey: string | undefined, leagueId: string, baseUrl?: string) {
    return this.requestJson<{ teams?: Array<Record<string, unknown>> }>(
      this.buildUrl(`/lookup_all_teams.php?id=${leagueId}`, apiKey, baseUrl),
      "the_sports_db league teams"
    );
  }

  async lookupTeam(apiKey: string | undefined, teamId: string, baseUrl?: string) {
    return this.requestJson<{ teams?: Array<Record<string, unknown>> }>(
      this.buildUrl(`/lookupteam.php?id=${teamId}`, apiKey, baseUrl),
      "the_sports_db lookup team"
    );
  }

  async searchTeamsByName(apiKey: string | undefined, teamName: string, baseUrl?: string) {
    const query = encodeURIComponent(teamName.trim());
    return this.requestJson<{ teams?: Array<Record<string, unknown>> }>(
      this.buildUrl(`/searchteams.php?t=${query}`, apiKey, baseUrl),
      "the_sports_db search teams"
    );
  }

  async lookupEvent(apiKey: string | undefined, eventId: string, baseUrl?: string) {
    return this.requestJson<{ events?: Array<Record<string, unknown>> }>(
      this.buildUrl(`/lookupevent.php?id=${eventId}`, apiKey, baseUrl),
      "the_sports_db lookup event"
    );
  }

  async lookupEventStats(apiKey: string | undefined, eventId: string, baseUrl?: string) {
    return this.requestJson<{ eventstats?: Array<Record<string, unknown>> }>(
      this.buildUrl(`/lookupeventstats.php?id=${eventId}`, apiKey, baseUrl),
      "the_sports_db lookup event stats"
    );
  }

  async lookupTimeline(apiKey: string | undefined, eventId: string, baseUrl?: string) {
    return this.requestJson<{ timeline?: Array<Record<string, unknown>> }>(
      this.buildUrl(`/lookuptimeline.php?id=${eventId}`, apiKey, baseUrl),
      "the_sports_db lookup timeline"
    );
  }
}
