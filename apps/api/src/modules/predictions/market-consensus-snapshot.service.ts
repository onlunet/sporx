import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../prisma/prisma.service";

type BuildMarketConsensusInput = {
  matchId: string;
  horizon: string;
  cutoffAt: Date;
};

type ConsensusRow = {
  market: string;
  line: number | null;
  lineKey: string;
  selection: string;
  openingProbability: number | null;
  latestProbability: number | null;
  bookmakerSpread: number | null;
  oddsDrift: number | null;
  updateRecencyMinutes: number | null;
  providerDisagreement: number | null;
  suspiciousVolatility: boolean;
  bookmakerCount: number;
};

@Injectable()
export class MarketConsensusSnapshotService {
  private readonly logger = new Logger(MarketConsensusSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  private normalizeCutoff(value: Date) {
    return new Date(Math.floor(value.getTime() / 1000) * 1000);
  }

  private round(value: number, digits = 6) {
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private avg(values: number[]) {
    if (values.length === 0) {
      return 0;
    }
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private std(values: number[]) {
    if (values.length <= 1) {
      return 0;
    }
    const mean = this.avg(values);
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private median(values: number[]) {
    if (values.length === 0) {
      return null;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) {
      return sorted[mid];
    }
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private lineKey(line: number | null) {
    if (line === null || line === undefined || !Number.isFinite(line)) {
      return "na";
    }
    return Number(line).toFixed(2);
  }

  private normalizeMarket(value: string) {
    const token = value.trim().toLowerCase();
    if (["match_result", "match_outcome", "moneyline"].includes(token)) {
      return "match_outcome";
    }
    if (["both_teams_to_score", "btts"].includes(token)) {
      return "both_teams_to_score";
    }
    if (["total_goals_over_under", "total_goals", "over_under"].includes(token)) {
      return "total_goals_over_under";
    }
    if (["first_half_result"].includes(token)) {
      return "first_half_result";
    }
    if (["half_time_full_time", "htft"].includes(token)) {
      return "half_time_full_time";
    }
    return token;
  }

  private normalizeSelection(value: string) {
    const token = value.trim().toLowerCase();
    if (["h", "1", "home"].includes(token)) {
      return "home";
    }
    if (["x", "d", "draw"].includes(token)) {
      return "draw";
    }
    if (["a", "2", "away"].includes(token)) {
      return "away";
    }
    if (["y", "yes"].includes(token)) {
      return "yes";
    }
    if (["n", "no"].includes(token)) {
      return "no";
    }
    if (["o", "over"].includes(token)) {
      return "over";
    }
    if (["u", "under"].includes(token)) {
      return "under";
    }
    return token;
  }

  private stableStringify(value: unknown): string {
    if (value === null || value === undefined) {
      return "null";
    }
    if (typeof value !== "object") {
      return JSON.stringify(value);
    }
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${this.stableStringify(record[key])}`).join(",")}}`;
  }

  private hashPayload(value: unknown) {
    return createHash("sha256").update(this.stableStringify(value)).digest("hex");
  }

  async buildAndPersist(input: BuildMarketConsensusInput) {
    const cutoffAt = this.normalizeCutoff(input.cutoffAt);
    const match = await this.prisma.match.findUnique({
      where: { id: input.matchId },
      select: {
        id: true,
        leagueId: true
      }
    });
    if (!match) {
      throw new Error(`market_consensus_match_not_found:${input.matchId}`);
    }

    const rows = await this.prisma.oddsSnapshotV2.findMany({
      where: {
        matchId: match.id,
        collectedAt: { lte: cutoffAt }
      },
      select: {
        bookmaker: true,
        market: true,
        line: true,
        selection: true,
        normalizedProb: true,
        collectedAt: true
      },
      orderBy: [{ collectedAt: "asc" }]
    });

    const grouped = new Map<string, typeof rows>();
    for (const row of rows) {
      const market = this.normalizeMarket(row.market);
      const selection = this.normalizeSelection(row.selection);
      const key = `${market}|${this.lineKey(row.line)}|${selection}`;
      const current = grouped.get(key) ?? [];
      current.push(row);
      grouped.set(key, current);
    }

    const consensusRows: ConsensusRow[] = [];
    for (const [key, group] of grouped.entries()) {
      const [market, lineKey, selection] = key.split("|");
      const line = lineKey === "na" ? null : Number(lineKey);
      const opening = group[0]?.normalizedProb ?? null;

      const latestByBookmaker = new Map<string, { prob: number; collectedAt: Date }>();
      for (const row of group) {
        latestByBookmaker.set(row.bookmaker, {
          prob: row.normalizedProb,
          collectedAt: row.collectedAt
        });
      }

      const latestProbs = [...latestByBookmaker.values()].map((item) => item.prob);
      const latestMedian = this.median(latestProbs);
      const latestMax = latestProbs.length > 0 ? Math.max(...latestProbs) : null;
      const latestMin = latestProbs.length > 0 ? Math.min(...latestProbs) : null;
      const spread =
        latestMax === null || latestMin === null ? null : this.round(Math.max(0, latestMax - latestMin), 6);
      const drift =
        latestMedian === null || opening === null ? null : this.round(latestMedian - opening, 6);
      const providerDisagreement = latestProbs.length < 2 ? null : this.round(this.std(latestProbs), 6);

      const latestTimestamp =
        [...latestByBookmaker.values()].reduce<Date | null>((acc, item) => {
          if (!acc || item.collectedAt.getTime() > acc.getTime()) {
            return item.collectedAt;
          }
          return acc;
        }, null) ?? null;

      const recencyMinutes =
        latestTimestamp === null
          ? null
          : this.round(Math.max(0, (cutoffAt.getTime() - latestTimestamp.getTime()) / 60000), 2);

      const suspiciousVolatility =
        Math.abs(drift ?? 0) >= 0.09 ||
        (spread ?? 0) >= 0.12 ||
        (providerDisagreement ?? 0) >= 0.06;

      consensusRows.push({
        market,
        line,
        lineKey,
        selection,
        openingProbability: opening === null ? null : this.round(this.clamp(opening, 0, 1), 6),
        latestProbability: latestMedian === null ? null : this.round(this.clamp(latestMedian, 0, 1), 6),
        bookmakerSpread: spread,
        oddsDrift: drift,
        updateRecencyMinutes: recencyMinutes,
        providerDisagreement,
        suspiciousVolatility,
        bookmakerCount: latestProbs.length
      });
    }

    const avgSpread = this.avg(
      consensusRows.map((row) => row.bookmakerSpread).filter((item): item is number => item !== null)
    );
    const avgDriftMagnitude = this.avg(
      consensusRows
        .map((row) => row.oddsDrift)
        .filter((item): item is number => item !== null)
        .map((value) => Math.abs(value))
    );
    const avgRecency = this.avg(
      consensusRows
        .map((row) => row.updateRecencyMinutes)
        .filter((item): item is number => item !== null)
    );
    const coverageRows = consensusRows.filter((row) => row.latestProbability !== null).length;
    const volatilityCount = consensusRows.filter((row) => row.suspiciousVolatility).length;

    const consensusJson = {
      cutoffAt: cutoffAt.toISOString(),
      markets: consensusRows,
      summary: {
        coverage_rows: coverageRows,
        total_rows: consensusRows.length,
        suspicious_volatility_rows: volatilityCount,
        avg_bookmaker_spread: this.round(avgSpread, 6),
        avg_drift_magnitude: this.round(avgDriftMagnitude, 6),
        avg_update_recency_minutes: this.round(avgRecency, 2)
      }
    };

    const consensusHash = this.hashPayload(consensusJson);
    const existing = await this.prisma.marketConsensusSnapshot.findFirst({
      where: {
        matchId: match.id,
        horizon: input.horizon,
        cutoffAt,
        consensusHash
      }
    });
    if (existing) {
      return existing;
    }

    try {
      return await this.prisma.marketConsensusSnapshot.create({
        data: {
          matchId: match.id,
          horizon: input.horizon,
          cutoffAt,
          consensusHash,
          consensusJson: consensusJson as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      this.logger.warn(
        `market consensus snapshot create fallback for ${match.id}/${input.horizon}: ${
          error instanceof Error ? error.message : "unknown"
        }`
      );
      const fallback = await this.prisma.marketConsensusSnapshot.findFirst({
        where: {
          matchId: match.id,
          horizon: input.horizon,
          cutoffAt,
          consensusHash
        }
      });
      if (!fallback) {
        throw error;
      }
      return fallback;
    }
  }

  resolveMarketProbability(
    consensusJson: unknown,
    market: string,
    line: number | null,
    selection: string | null
  ) {
    if (!consensusJson || typeof consensusJson !== "object" || Array.isArray(consensusJson)) {
      return null;
    }
    const record = consensusJson as Record<string, unknown>;
    const markets = Array.isArray(record.markets) ? record.markets : [];
    const normalizedMarket = this.normalizeMarket(market);
    const normalizedSelection = this.normalizeSelection(selection ?? "");
    const targetLineKey = this.lineKey(line);

    for (const row of markets) {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        continue;
      }
      const rec = row as Record<string, unknown>;
      const rowMarket = typeof rec.market === "string" ? rec.market : "";
      const rowSelection = typeof rec.selection === "string" ? rec.selection : "";
      const rowLine =
        typeof rec.lineKey === "string"
          ? rec.lineKey
          : typeof rec.line === "number" && Number.isFinite(rec.line)
            ? this.lineKey(rec.line)
            : "na";
      if (rowMarket !== normalizedMarket || rowSelection !== normalizedSelection || rowLine !== targetLineKey) {
        continue;
      }
      const latestProbability =
        typeof rec.latestProbability === "number" && Number.isFinite(rec.latestProbability)
          ? rec.latestProbability
          : null;
      if (latestProbability !== null) {
        return this.round(this.clamp(latestProbability, 0.0001, 0.9999), 6);
      }
    }

    return null;
  }
}

