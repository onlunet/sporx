import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";

type FeatureKey = "lineup_enrichment_enabled" | "event_enrichment_enabled" | "odds_meta_model_enabled";

type FeatureFlagConfig = {
  enabled: boolean;
  leagues?: string[];
  markets?: string[];
};

type EnrichmentFlagState = Record<FeatureKey, FeatureFlagConfig>;

type FeatureCheckInput = {
  feature: FeatureKey;
  leagueId?: string | null;
  market?: string | null;
};

@Injectable()
export class EnrichmentFlagsService {
  private readonly keyMap: Record<FeatureKey, string> = {
    lineup_enrichment_enabled: "pipeline.flags.lineup_enrichment_enabled",
    event_enrichment_enabled: "pipeline.flags.event_enrichment_enabled",
    odds_meta_model_enabled: "pipeline.flags.odds_meta_model_enabled"
  };

  constructor(private readonly prisma: PrismaService) {}

  private asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  private parseConfig(value: unknown, fallbackEnabled: boolean): FeatureFlagConfig {
    if (typeof value === "boolean") {
      return { enabled: value };
    }

    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (normalized === "true" || normalized === "1") {
        return { enabled: true };
      }
      if (normalized === "false" || normalized === "0") {
        return { enabled: false };
      }
    }

    const record = this.asRecord(value);
    if (!record) {
      return { enabled: fallbackEnabled };
    }

    const enabledRaw = record.enabled;
    const enabled =
      typeof enabledRaw === "boolean"
        ? enabledRaw
        : typeof enabledRaw === "string"
          ? enabledRaw.toLowerCase() === "true" || enabledRaw === "1"
          : fallbackEnabled;

    return {
      enabled,
      leagues: this.asStringArray(record.leagues),
      markets: this.asStringArray(record.markets)
    };
  }

  async getFlags(): Promise<EnrichmentFlagState> {
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: Object.values(this.keyMap)
        }
      },
      select: { key: true, value: true }
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    return {
      lineup_enrichment_enabled: this.parseConfig(byKey.get(this.keyMap.lineup_enrichment_enabled), true),
      event_enrichment_enabled: this.parseConfig(byKey.get(this.keyMap.event_enrichment_enabled), true),
      odds_meta_model_enabled: this.parseConfig(byKey.get(this.keyMap.odds_meta_model_enabled), false)
    };
  }

  async isEnabled(input: FeatureCheckInput) {
    const flags = await this.getFlags();
    const config = flags[input.feature];
    if (!config.enabled) {
      return false;
    }

    if (config.leagues && config.leagues.length > 0) {
      if (!input.leagueId || !config.leagues.includes(input.leagueId)) {
        return false;
      }
    }

    if (config.markets && config.markets.length > 0) {
      if (!input.market || !config.markets.includes(input.market)) {
        return false;
      }
    }

    return true;
  }
}
