import { Injectable } from "@nestjs/common";
import { NormalizedMarketType, NormalizedOddsEntry } from "./odds-types";

type UnknownRecord = Record<string, unknown>;

type OddsApiEventShape = {
  id?: string | number;
  bookmakers?: Record<string, unknown>;
};

@Injectable()
export class OddsNormalizationService {
  private asRecord(value: unknown): UnknownRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as UnknownRecord;
  }

  private asNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return null;
  }

  private normalizeMarketType(rawName: string): NormalizedMarketType | null {
    const key = rawName.trim().toLowerCase();
    if (["ml", "1x2", "match result", "full time result"].includes(key)) {
      return "matchResult";
    }
    if (["first half result", "1st half result", "half time result"].includes(key)) {
      return "firstHalfResult";
    }
    if (["both teams to score", "btts"].includes(key)) {
      return "bothTeamsToScore";
    }
    if (["over/under", "goals over/under", "total goals over/under"].includes(key)) {
      return "totalGoalsOverUnder";
    }
    if (["correct score"].includes(key)) {
      return "correctScore";
    }
    if (["half time/full time", "ht/ft", "half-time/full-time"].includes(key)) {
      return "halfTimeFullTime";
    }
    return null;
  }

  private normalizeSelectionKey(marketType: NormalizedMarketType, rawKey: string): string {
    const key = rawKey.trim().toLowerCase();
    if (marketType === "matchResult" || marketType === "firstHalfResult") {
      if (["home", "1", "h"].includes(key)) return "home";
      if (["draw", "x", "d"].includes(key)) return "draw";
      if (["away", "2", "a"].includes(key)) return "away";
    }
    if (marketType === "bothTeamsToScore") {
      if (["yes", "y", "btts_yes", "var"].includes(key)) return "yes";
      if (["no", "n", "btts_no", "yok"].includes(key)) return "no";
    }
    if (marketType === "totalGoalsOverUnder") {
      if (["over", "o"].includes(key)) return "over";
      if (["under", "u"].includes(key)) return "under";
    }
    if (marketType === "halfTimeFullTime") {
      const compact = key.replace(/\s+/g, "").replace("/", "_");
      const mapping: Record<string, string> = {
        "home_home": "home_home",
        "home_draw": "home_draw",
        "home_away": "home_away",
        "draw_home": "draw_home",
        "draw_draw": "draw_draw",
        "draw_away": "draw_away",
        "away_home": "away_home",
        "away_draw": "away_draw",
        "away_away": "away_away",
        hh: "home_home",
        hd: "home_draw",
        ha: "home_away",
        dh: "draw_home",
        dd: "draw_draw",
        da: "draw_away",
        ah: "away_home",
        ad: "away_draw",
        aa: "away_away"
      };
      return mapping[compact] ?? compact;
    }
    if (marketType === "correctScore") {
      return key.replace(":", "-");
    }
    return key;
  }

  private pushEntry(
    target: NormalizedOddsEntry[],
    entry: {
      bookmaker: string;
      marketType: NormalizedMarketType;
      selectionKey: string;
      line?: number | null;
      oddsValue: number | null;
      capturedAt: Date;
    }
  ) {
    if (!entry.oddsValue || entry.oddsValue <= 1) {
      return;
    }
    target.push({
      bookmaker: entry.bookmaker,
      marketType: entry.marketType,
      selectionKey: this.normalizeSelectionKey(entry.marketType, entry.selectionKey),
      line: entry.line ?? null,
      oddsValue: entry.oddsValue,
      capturedAt: entry.capturedAt
    });
  }

  normalizeEventOdds(event: OddsApiEventShape, defaultCapturedAt = new Date()): NormalizedOddsEntry[] {
    const bookmakersRecord = this.asRecord(event.bookmakers);
    if (!bookmakersRecord) {
      return [];
    }

    const normalized: NormalizedOddsEntry[] = [];

    for (const [bookmaker, marketListRaw] of Object.entries(bookmakersRecord)) {
      if (!Array.isArray(marketListRaw)) {
        continue;
      }

      for (const marketRaw of marketListRaw) {
        const market = this.asRecord(marketRaw);
        if (!market) {
          continue;
        }

        const marketName = typeof market.name === "string" ? market.name : "";
        const marketType = this.normalizeMarketType(marketName);
        if (!marketType) {
          continue;
        }

        const capturedAt = typeof market.updatedAt === "string" ? new Date(market.updatedAt) : defaultCapturedAt;
        const validCapturedAt = Number.isFinite(capturedAt.getTime()) ? capturedAt : defaultCapturedAt;
        const oddsRows = Array.isArray(market.odds) ? market.odds : [];

        for (const oddsRaw of oddsRows) {
          const odds = this.asRecord(oddsRaw);
          if (!odds) {
            continue;
          }

          if (marketType === "matchResult" || marketType === "firstHalfResult") {
            this.pushEntry(normalized, {
              bookmaker,
              marketType,
              selectionKey: "home",
              oddsValue: this.asNumber(odds.home),
              capturedAt: validCapturedAt
            });
            this.pushEntry(normalized, {
              bookmaker,
              marketType,
              selectionKey: "draw",
              oddsValue: this.asNumber(odds.draw),
              capturedAt: validCapturedAt
            });
            this.pushEntry(normalized, {
              bookmaker,
              marketType,
              selectionKey: "away",
              oddsValue: this.asNumber(odds.away),
              capturedAt: validCapturedAt
            });
            continue;
          }

          if (marketType === "bothTeamsToScore") {
            this.pushEntry(normalized, {
              bookmaker,
              marketType,
              selectionKey: "yes",
              oddsValue: this.asNumber(odds.yes),
              capturedAt: validCapturedAt
            });
            this.pushEntry(normalized, {
              bookmaker,
              marketType,
              selectionKey: "no",
              oddsValue: this.asNumber(odds.no),
              capturedAt: validCapturedAt
            });
            continue;
          }

          if (marketType === "totalGoalsOverUnder") {
            const line = this.asNumber(odds.max) ?? this.asNumber(odds.line);
            this.pushEntry(normalized, {
              bookmaker,
              marketType,
              selectionKey: "over",
              oddsValue: this.asNumber(odds.over),
              line,
              capturedAt: validCapturedAt
            });
            this.pushEntry(normalized, {
              bookmaker,
              marketType,
              selectionKey: "under",
              oddsValue: this.asNumber(odds.under),
              line,
              capturedAt: validCapturedAt
            });
            continue;
          }

          if (marketType === "halfTimeFullTime") {
            for (const [selectionKey, value] of Object.entries(odds)) {
              this.pushEntry(normalized, {
                bookmaker,
                marketType,
                selectionKey,
                oddsValue: this.asNumber(value),
                capturedAt: validCapturedAt
              });
            }
            continue;
          }

          if (marketType === "correctScore") {
            for (const [selectionKey, value] of Object.entries(odds)) {
              this.pushEntry(normalized, {
                bookmaker,
                marketType,
                selectionKey,
                oddsValue: this.asNumber(value),
                capturedAt: validCapturedAt
              });
            }
          }
        }
      }
    }

    return normalized;
  }
}
