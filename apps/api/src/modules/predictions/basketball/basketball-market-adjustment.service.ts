import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../../prisma/prisma.service";
import { BasketballMarketSnapshot } from "./basketball-feature.types";

@Injectable()
export class BasketballMarketAdjustmentService {
  constructor(private readonly prisma: PrismaService) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private average(values: number[]) {
    if (values.length === 0) {
      return null;
    }
    return values.reduce((acc, value) => acc + value, 0) / values.length;
  }

  private normalizeOutcome(home: number | null, draw: number | null, away: number | null) {
    const safeHome = typeof home === "number" ? this.clamp(home, 0, 1) : null;
    const safeDraw = typeof draw === "number" ? this.clamp(draw, 0, 1) : null;
    const safeAway = typeof away === "number" ? this.clamp(away, 0, 1) : null;
    if (safeHome === null && safeAway === null) {
      return {
        home: null,
        draw: null,
        away: null
      };
    }

    const defaultDraw = safeDraw ?? 0.004;
    const sum = (safeHome ?? 0) + defaultDraw + (safeAway ?? 0);
    if (sum <= 0) {
      return {
        home: null,
        draw: null,
        away: null
      };
    }

    return {
      home: safeHome === null ? null : Number((safeHome / sum).toFixed(4)),
      draw: Number((defaultDraw / sum).toFixed(4)),
      away: safeAway === null ? null : Number((safeAway / sum).toFixed(4))
    };
  }

  async loadSnapshot(matchId: string, cutoffAt: Date): Promise<BasketballMarketSnapshot> {
    const snapshots = await this.prisma.oddsSnapshot.findMany({
      where: {
        matchId,
        capturedAt: { lte: cutoffAt }
      },
      orderBy: { capturedAt: "desc" },
      take: 240,
      select: {
        marketType: true,
        selectionKey: true,
        line: true,
        impliedProbability: true,
        capturedAt: true
      }
    });

    if (snapshots.length === 0) {
      return {
        hasMarketData: false,
        moneyline: {
          home: null,
          draw: null,
          away: null
        },
        totals: [],
        freshnessMinutes: null,
        coverageScore: 0
      };
    }

    const moneylineRows = snapshots.filter((row) => {
      const marketType = row.marketType.toLowerCase();
      return marketType === "matchresult" || marketType === "moneyline";
    });
    const homeValues = moneylineRows
      .filter((row) => {
        const key = row.selectionKey.toLowerCase();
        return key === "home" || key === "1";
      })
      .map((row) => row.impliedProbability);
    const drawValues = moneylineRows
      .filter((row) => {
        const key = row.selectionKey.toLowerCase();
        return key === "draw" || key === "x";
      })
      .map((row) => row.impliedProbability);
    const awayValues = moneylineRows
      .filter((row) => {
        const key = row.selectionKey.toLowerCase();
        return key === "away" || key === "2";
      })
      .map((row) => row.impliedProbability);

    const outcome = this.normalizeOutcome(
      this.average(homeValues),
      this.average(drawValues),
      this.average(awayValues)
    );

    const totalsByLine = new Map<
      number,
      {
        over: number[];
        under: number[];
      }
    >();
    for (const row of snapshots) {
      const marketType = row.marketType.toLowerCase();
      if (marketType !== "totalgoalsoverunder" && marketType !== "total") {
        continue;
      }
      if (typeof row.line !== "number" || !Number.isFinite(row.line)) {
        continue;
      }
      const key = Number(row.line.toFixed(1));
      if (!totalsByLine.has(key)) {
        totalsByLine.set(key, { over: [], under: [] });
      }
      const bucket = totalsByLine.get(key);
      if (!bucket) {
        continue;
      }
      const selection = row.selectionKey.toLowerCase();
      if (selection.includes("over")) {
        bucket.over.push(row.impliedProbability);
      }
      if (selection.includes("under")) {
        bucket.under.push(row.impliedProbability);
      }
    }

    const totals = Array.from(totalsByLine.entries())
      .map(([line, values]) => {
        const over = this.average(values.over);
        const under = this.average(values.under);
        if (over === null || under === null) {
          return null;
        }
        const sum = over + under || 1;
        return {
          line,
          over: Number((over / sum).toFixed(4)),
          under: Number((under / sum).toFixed(4))
        };
      })
      .filter((item): item is { line: number; over: number; under: number } => item !== null)
      .sort((left, right) => left.line - right.line);

    const newest = snapshots[0]?.capturedAt ?? null;
    const freshnessMinutes = newest ? Math.max(0, (Date.now() - newest.getTime()) / (60 * 1000)) : null;

    return {
      hasMarketData: moneylineRows.length > 0 || totals.length > 0,
      moneyline: outcome,
      totals,
      freshnessMinutes,
      coverageScore: this.clamp(snapshots.length / 70, 0, 1)
    };
  }
}
