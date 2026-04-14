import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Prisma, Provider } from "@prisma/client";
import { CacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import { MarketComparisonService } from "../odds/market-comparison.service";
import { OddsFeatureService } from "../odds/odds-feature.service";
import { OddsNormalizationService } from "../odds/odds-normalization.service";
import { OddsSchemaBootstrapService } from "../odds/odds-schema-bootstrap.service";
import { NormalizedMarketType } from "../odds/odds-types";
import { expandPredictionMarkets } from "../predictions/prediction-markets.util";
import { OddsApiIoConnector } from "./odds-api-io.connector";

type ProviderSyncResult = {
  providerKey: string;
  recordsRead: number;
  recordsWritten: number;
  errors: number;
  details: Record<string, unknown>;
};

type ProviderRuntimeSettings = {
  apiKey?: string;
  baseUrl?: string;
  dailyLimit?: number;
  oddsSport?: string;
  oddsBookmakers?: string;
  oddsLeague?: string;
  oddsLimit?: number;
};

type MatchCandidate = {
  id: string;
  kickoffAt: Date;
  home: string;
  away: string;
};

type SimpleEvent = {
  id: string;
  home: string;
  away: string;
  date: Date;
};

@Injectable()
export class OddsIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly connector: OddsApiIoConnector,
    private readonly normalization: OddsNormalizationService,
    private readonly featureService: OddsFeatureService,
    private readonly marketComparisonService: MarketComparisonService,
    private readonly oddsSchemaBootstrapService: OddsSchemaBootstrapService
  ) {}

  supports(jobType: string) {
    return ["syncOddsPreMatch", "syncOddsLive", "syncOddsClosing", "generateMarketAnalysis"].includes(jobType);
  }

  private round2(value: number | null | undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return Number(value.toFixed(2));
  }

  private normalizeName(value: string) {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
  }

  private marketTypeFromPredictionType(predictionType: string): NormalizedMarketType | null {
    if (predictionType === "fullTimeResult") return "matchResult";
    if (predictionType === "firstHalfResult") return "firstHalfResult";
    if (predictionType === "bothTeamsToScore") return "bothTeamsToScore";
    if (predictionType === "totalGoalsOverUnder") return "totalGoalsOverUnder";
    if (predictionType === "correctScore") return "correctScore";
    if (predictionType === "halfTimeFullTime") return "halfTimeFullTime";
    return null;
  }

  private async logApiCall(path: string, statusCode: number, durationMs: number) {
    await this.prisma.apiLog.create({
      data: {
        method: "GET",
        path,
        statusCode,
        durationMs
      }
    });
  }

  private async createPayload(providerKey: string, entityType: string, payload: Prisma.InputJsonValue) {
    await this.prisma.externalSourcePayload.create({
      data: {
        providerKey,
        entityType,
        payload
      }
    });
  }

  private extractEvents(rawEvents: Array<Record<string, unknown>>): SimpleEvent[] {
    const items: SimpleEvent[] = [];
    for (const raw of rawEvents) {
      const idRaw = raw.id;
      const homeRaw = raw.home;
      const awayRaw = raw.away;
      const dateRaw = raw.date;

      const id = typeof idRaw === "number" || typeof idRaw === "string" ? String(idRaw) : "";
      const home = typeof homeRaw === "string" ? homeRaw.trim() : "";
      const away = typeof awayRaw === "string" ? awayRaw.trim() : "";
      const date = typeof dateRaw === "string" ? new Date(dateRaw) : null;

      if (!id || !home || !away || !date || !Number.isFinite(date.getTime())) {
        continue;
      }
      items.push({ id, home, away, date });
    }
    return items;
  }

  private async matchEventsToMatches(providerId: string, sportCode: string, events: SimpleEvent[]) {
    if (events.length === 0) {
      return new Map<string, string>();
    }

    const minDate = new Date(Math.min(...events.map((item) => item.date.getTime())) - 12 * 60 * 60 * 1000);
    const maxDate = new Date(Math.max(...events.map((item) => item.date.getTime())) + 12 * 60 * 60 * 1000);

    const existingMappings = await this.prisma.matchOddsMapping.findMany({
      where: {
        providerId,
        providerMatchKey: { in: events.map((item) => item.id) }
      }
    });
    const mappingByProviderKey = new Map(existingMappings.map((item) => [item.providerMatchKey, item.matchId]));

    const unmatchedEvents = events.filter((event) => !mappingByProviderKey.has(event.id));
    if (unmatchedEvents.length === 0) {
      return mappingByProviderKey;
    }

    const candidates = await this.prisma.match.findMany({
      where: {
        sport: { code: sportCode },
        matchDateTimeUTC: { gte: minDate, lte: maxDate }
      },
      select: {
        id: true,
        matchDateTimeUTC: true,
        homeTeam: { select: { name: true } },
        awayTeam: { select: { name: true } }
      }
    });

    const matchCandidates: MatchCandidate[] = candidates.map((item) => ({
      id: item.id,
      kickoffAt: item.matchDateTimeUTC,
      home: item.homeTeam.name,
      away: item.awayTeam.name
    }));

    for (const event of unmatchedEvents) {
      const homeNorm = this.normalizeName(event.home);
      const awayNorm = this.normalizeName(event.away);

      const matched = matchCandidates
        .map((match) => {
          const homeMatch = this.normalizeName(match.home) === homeNorm;
          const awayMatch = this.normalizeName(match.away) === awayNorm;
          if (!homeMatch || !awayMatch) {
            return null;
          }
          return {
            matchId: match.id,
            diffMs: Math.abs(match.kickoffAt.getTime() - event.date.getTime())
          };
        })
        .filter((item): item is { matchId: string; diffMs: number } => Boolean(item))
        .sort((left, right) => left.diffMs - right.diffMs)[0];

      if (!matched || matched.diffMs > 6 * 60 * 60 * 1000) {
        continue;
      }

      await this.prisma.matchOddsMapping.upsert({
        where: {
          providerId_providerMatchKey: {
            providerId,
            providerMatchKey: event.id
          }
        },
        update: {
          matchId: matched.matchId,
          mappingConfidence: 0.9
        },
        create: {
          id: randomUUID(),
          providerId,
          providerMatchKey: event.id,
          matchId: matched.matchId,
          mappingConfidence: 0.9
        }
      });

      mappingByProviderKey.set(event.id, matched.matchId);
    }

    return mappingByProviderKey;
  }

  private toIsoUtc(date: Date) {
    return new Date(date.getTime() - date.getMilliseconds()).toISOString();
  }

  private async buildOddsSnapshots(
    provider: Pick<Provider, "id" | "key" | "baseUrl">,
    settings: ProviderRuntimeSettings,
    jobType: string
  ) {
    if (!settings.apiKey) {
      return {
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: { message: "ODDS_API_IO_API_KEY eksik, odds sync atlandı." }
      };
    }

    const sport = settings.oddsSport?.trim() || "football";
    const bookmakers = settings.oddsBookmakers?.trim() || "Bet365,Unibet,SingBet";
    const limit = Math.max(1, Math.min(settings.oddsLimit ?? 60, 100));
    const now = new Date();
    const sixHoursLater = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const fortyEightHoursLater = new Date(now.getTime() + 48 * 60 * 60 * 1000);

    const startedAt = Date.now();
    const eventsRaw =
      jobType === "syncOddsLive"
        ? await this.connector.fetchLiveEvents(settings.apiKey, sport, settings.baseUrl ?? provider.baseUrl ?? undefined)
        : await this.connector.fetchEvents(
            settings.apiKey,
            {
              sport,
              status: jobType === "syncOddsClosing" ? "pending,live" : "pending",
              from: this.toIsoUtc(now),
              to: this.toIsoUtc(jobType === "syncOddsClosing" ? sixHoursLater : fortyEightHoursLater),
              limit,
              league: settings.oddsLeague,
              bookmaker: bookmakers.split(",")[0]
            },
            settings.baseUrl ?? provider.baseUrl ?? undefined
          );
    const durationMs = Date.now() - startedAt;
    await this.logApiCall(`provider/${provider.key}/events`, 200, durationMs);

    const events = this.extractEvents(eventsRaw);
    if (events.length === 0) {
      return {
        recordsRead: 0,
        recordsWritten: 0,
        errors: 0,
        details: { message: "Odds provider event bulunamadı.", sport }
      };
    }

    const mapping = await this.matchEventsToMatches(provider.id, sport, events);
    const matchedEventIds = events.filter((event) => mapping.has(event.id)).map((event) => event.id);
    if (matchedEventIds.length === 0) {
      return {
        recordsRead: events.length,
        recordsWritten: 0,
        errors: 0,
        details: { message: "Event eşleşmesi bulunamadı.", sport }
      };
    }

    const chunks: string[][] = [];
    for (let index = 0; index < matchedEventIds.length; index += 10) {
      chunks.push(matchedEventIds.slice(index, index + 10));
    }

    const normalizedEntries: Array<{
      matchId: string;
      bookmaker: string;
      marketType: string;
      selectionKey: string;
      line: number | null;
      oddsValue: number;
      impliedProbability: number;
      fairProbability: number | null;
      capturedAt: Date;
      isOpening: boolean;
      isClosingCandidate: boolean;
    }> = [];

    for (const chunk of chunks) {
      const oddsStartedAt = Date.now();
      const oddsEvents = await this.connector.fetchMultiOdds(
        settings.apiKey,
        chunk,
        bookmakers,
        settings.baseUrl ?? provider.baseUrl ?? undefined
      );
      await this.logApiCall(`provider/${provider.key}/odds/multi`, 200, Date.now() - oddsStartedAt);

      for (const oddsEvent of oddsEvents) {
        const eventIdRaw = oddsEvent.id;
        const eventId =
          typeof eventIdRaw === "number" || typeof eventIdRaw === "string" ? String(eventIdRaw) : "";
        if (!eventId) {
          continue;
        }
        const matchId = mapping.get(eventId);
        if (!matchId) {
          continue;
        }

        const entries = this.normalization.normalizeEventOdds(oddsEvent, new Date());
        if (entries.length === 0) {
          continue;
        }

        const groupMap = new Map<string, typeof entries>();
        for (const entry of entries) {
          const key = `${entry.bookmaker}|${entry.marketType}|${this.round2(entry.line)}`;
          const bucket = groupMap.get(key) ?? [];
          bucket.push(entry);
          groupMap.set(key, bucket);
        }

        for (const bucket of groupMap.values()) {
          const implied = bucket.map((entry) => this.featureService.impliedProbabilityFromDecimalOdds(entry.oddsValue));
          const fair = this.featureService.removeBookmakerMargin(implied);

          for (let index = 0; index < bucket.length; index += 1) {
            const entry = bucket[index];
            const impliedProbability = implied[index] ?? 0;
            const fairProbability = fair[index] ?? null;

            normalizedEntries.push({
              matchId,
              bookmaker: entry.bookmaker,
              marketType: entry.marketType,
              selectionKey: entry.selectionKey,
              line: entry.line,
              oddsValue: entry.oddsValue,
              impliedProbability,
              fairProbability,
              capturedAt: entry.capturedAt,
              isOpening: jobType === "syncOddsPreMatch",
              isClosingCandidate: jobType === "syncOddsClosing" || jobType === "syncOddsLive"
            });
          }
        }
      }
    }

    if (normalizedEntries.length > 0) {
      await this.prisma.oddsSnapshot.createMany({
        data: normalizedEntries.map((entry) => ({
          id: randomUUID(),
          matchId: entry.matchId,
          providerId: provider.id,
          bookmaker: entry.bookmaker,
          marketType: entry.marketType,
          selectionKey: entry.selectionKey,
          line: entry.line,
          oddsValue: entry.oddsValue,
          impliedProbability: entry.impliedProbability,
          fairProbability: entry.fairProbability,
          capturedAt: entry.capturedAt,
          isOpening: entry.isOpening,
          isClosingCandidate: entry.isClosingCandidate
        }))
      });
    }

    await this.createPayload(provider.key, "odds_snapshots", {
      jobType,
      sport,
      bookmakers,
      eventCount: events.length,
      matchedEventCount: matchedEventIds.length,
      snapshotCount: normalizedEntries.length
    } as Prisma.InputJsonValue);

    await this.cache.invalidateTag("market-analysis");
    return {
      recordsRead: events.length,
      recordsWritten: normalizedEntries.length,
      errors: 0,
      details: {
        sport,
        bookmakers,
        matchedEventCount: matchedEventIds.length,
        snapshotCount: normalizedEntries.length
      }
    };
  }

  private async generateMarketAnalysisSnapshots(matchIds?: string[]) {
    const predictions = await this.prisma.prediction.findMany({
      where: {
        ...(matchIds && matchIds.length > 0 ? { matchId: { in: matchIds } } : {}),
        match: {
          status: { in: ["scheduled", "live", "finished"] }
        }
      },
      include: {
        match: {
          include: {
            homeTeam: true,
            awayTeam: true
          }
        }
      },
      orderBy: { updatedAt: "desc" },
      take: 400
    });

    if (predictions.length === 0) {
      return { recordsRead: 0, recordsWritten: 0, errors: 0 };
    }

    const predictionRows = predictions.flatMap((prediction) =>
      expandPredictionMarkets({
        matchId: prediction.matchId,
        modelVersionId: prediction.modelVersionId,
        probabilities: prediction.probabilities,
        calibratedProbabilities: prediction.calibratedProbabilities,
        rawProbabilities: prediction.rawProbabilities,
        expectedScore: prediction.expectedScore,
        confidenceScore: prediction.confidenceScore,
        summary: prediction.summary,
        riskFlags: prediction.riskFlags,
        avoidReason: prediction.avoidReason,
        updatedAt: prediction.updatedAt,
        match: {
          homeTeam: { name: prediction.match.homeTeam.name },
          awayTeam: { name: prediction.match.awayTeam.name },
          matchDateTimeUTC: prediction.match.matchDateTimeUTC,
          status: prediction.match.status,
          homeScore: prediction.match.homeScore,
          awayScore: prediction.match.awayScore,
          halfTimeHomeScore: prediction.match.halfTimeHomeScore,
          halfTimeAwayScore: prediction.match.halfTimeAwayScore
        }
      }).map((item) => ({
        item,
        predictionUpdatedAt: prediction.updatedAt
      }))
    );

    const supported = predictionRows.filter((row) => this.marketTypeFromPredictionType(row.item.predictionType) !== null);
    if (supported.length === 0) {
      return { recordsRead: predictionRows.length, recordsWritten: 0, errors: 0 };
    }

    const involvedMatchIds = [...new Set(supported.map((row) => row.item.matchId))];
    const oddsSnapshots = await this.prisma.oddsSnapshot.findMany({
      where: {
        matchId: { in: involvedMatchIds }
      },
      orderBy: { capturedAt: "asc" }
    });

    const snapshotsByKey = new Map<string, typeof oddsSnapshots>();
    for (const snapshot of oddsSnapshots) {
      const key = `${snapshot.matchId}|${snapshot.marketType}|${this.round2(snapshot.line)}|${snapshot.selectionKey}`;
      const bucket = snapshotsByKey.get(key) ?? [];
      bucket.push(snapshot);
      snapshotsByKey.set(key, bucket);
    }

    await this.prisma.marketAnalysisSnapshot.deleteMany({
      where: {
        matchId: { in: involvedMatchIds }
      }
    });

    const toCreate: Prisma.MarketAnalysisSnapshotCreateManyInput[] = [];
    for (const row of supported) {
      const marketType = this.marketTypeFromPredictionType(row.item.predictionType);
      if (!marketType) {
        continue;
      }

      const probabilities = row.item.probabilities;
      const sortedEntries = Object.entries(probabilities)
        .filter(([, value]) => Number.isFinite(value))
        .sort((left, right) => right[1] - left[1]);
      const topEntry = sortedEntries[0];
      if (!topEntry) {
        continue;
      }

      const selectionKey = topEntry[0];
      const modelProbability = topEntry[1];
      const lookupKey = `${row.item.matchId}|${marketType}|${this.round2(row.item.line ?? null)}|${selectionKey}`;
      const relevantSnapshots = (snapshotsByKey.get(lookupKey) ?? []).filter(
        (snapshot) => snapshot.capturedAt.getTime() <= row.predictionUpdatedAt.getTime()
      );

      const summary = this.featureService.summarizeMarketSnapshots(
        relevantSnapshots.map((snapshot) => ({
          bookmaker: snapshot.bookmaker,
          impliedProbability: snapshot.impliedProbability,
          fairProbability: snapshot.fairProbability,
          capturedAt: snapshot.capturedAt
        })),
        row.predictionUpdatedAt
      );

      if (!summary) {
        continue;
      }

      const comparison = this.marketComparisonService.compare(modelProbability, summary);
      toCreate.push({
        id: randomUUID(),
        matchId: row.item.matchId,
        predictionType: row.item.predictionType,
        marketLine: row.item.line ?? null,
        modelProbability: comparison.modelProbability,
        marketImpliedProbability: comparison.marketImpliedProbability,
        fairMarketProbability: comparison.fairMarketProbability,
        probabilityGap: comparison.probabilityGap,
        movementDirection: comparison.movementDirection,
        volatilityScore: comparison.volatilityScore,
        consensusScore: comparison.consensusScore,
        contradictionScore: comparison.contradictionScore
      });
    }

    if (toCreate.length > 0) {
      await this.prisma.marketAnalysisSnapshot.createMany({ data: toCreate });
    }

    await this.cache.invalidateTag("market-analysis");
    return {
      recordsRead: supported.length,
      recordsWritten: toCreate.length,
      errors: 0
    };
  }

  async sync(
    provider: Pick<Provider, "id" | "key" | "baseUrl">,
    settings: ProviderRuntimeSettings,
    runId: string,
    jobType: string
  ): Promise<ProviderSyncResult> {
    const oddsSchemaReady = await this.oddsSchemaBootstrapService.ensureReady();
    if (!oddsSchemaReady) {
      return {
        providerKey: provider.key,
        recordsRead: 0,
        recordsWritten: 0,
        errors: 1,
        details: {
          message: "Odds schema bootstrap başarısız olduğu için job atlandı.",
          jobType,
          runId
        }
      };
    }

    if (jobType === "generateMarketAnalysis") {
      const summary = await this.generateMarketAnalysisSnapshots();
      await this.createPayload(provider.key, "market_analysis", {
        runId,
        jobType,
        ...summary
      } as Prisma.InputJsonValue);
      return {
        providerKey: provider.key,
        recordsRead: summary.recordsRead,
        recordsWritten: summary.recordsWritten,
        errors: summary.errors,
        details: { mode: "generateMarketAnalysis" }
      };
    }

    const summary = await this.buildOddsSnapshots(provider, settings, jobType);
    await this.generateMarketAnalysisSnapshots();

    return {
      providerKey: provider.key,
      recordsRead: summary.recordsRead,
      recordsWritten: summary.recordsWritten,
      errors: summary.errors,
      details: summary.details
    };
  }
}
