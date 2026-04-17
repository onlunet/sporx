import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { SelectionEngineSettings, StrategyProfileConfig, StrategyProfileKey } from "./publish-selection.types";

type ActivePolicyVersion = {
  policyId: string;
  policyKey: string;
  versionId: string;
  version: number;
  label: string;
  configJson: Prisma.JsonValue;
};

type ResolveProfileInput = {
  leagueId: string | null;
  market: string;
  horizon: string;
};

@Injectable()
export class SelectionEngineConfigService {
  private static readonly POLICY_KEY = "default_selection_policy";
  private static readonly SETTINGS_KEYS = {
    enabled: "selection_engine_enabled",
    shadowMode: "selection_engine_shadow_mode",
    defaultProfile: "strategy_profile_default",
    emergencyRollback: "selection_engine_emergency_rollback"
  } as const;

  private defaultsEnsured = false;

  constructor(private readonly prisma: PrismaService) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private toRecord(value: Prisma.JsonValue | unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    return value as Record<string, unknown>;
  }

  private toBoolean(value: Prisma.JsonValue | unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const token = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(token)) {
        return true;
      }
      if (["false", "0", "no", "off"].includes(token)) {
        return false;
      }
    }
    const record = this.toRecord(value);
    if (record) {
      return this.toBoolean(record.value, fallback);
    }
    return fallback;
  }

  private toNumber(value: Prisma.JsonValue | unknown, fallback: number): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    const record = this.toRecord(value);
    if (record) {
      return this.toNumber(record.value, fallback);
    }
    return fallback;
  }

  private toString(value: Prisma.JsonValue | unknown, fallback: string): string {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    const record = this.toRecord(value);
    if (record) {
      return this.toString(record.value, fallback);
    }
    return fallback;
  }

  private toStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [] as string[];
    }
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  private normalizeProfileKey(value: string | null | undefined): StrategyProfileKey {
    const token = (value ?? "").trim().toUpperCase();
    if (token === "CONSERVATIVE" || token === "AGGRESSIVE" || token === "BALANCED") {
      return token;
    }
    return "BALANCED";
  }

  private defaultProfileConfig(profileKey: StrategyProfileKey): StrategyProfileConfig {
    if (profileKey === "CONSERVATIVE") {
      return {
        minConfidence: 0.62,
        minPublishScore: 0.66,
        minEdge: 0.01,
        maxVolatility: 0.24,
        maxProviderDisagreement: 0.16,
        minLineupCoverage: 0.55,
        minEventCoverage: 0.45,
        maxMissingStatsRatio: 0.42,
        minFreshnessScore: 0.52,
        maxPicksPerMatch: 1,
        requireOdds: true,
        valueOnly: true,
        requireLineupHorizons: ["LINEUP", "LIVE_0_15", "LIVE_16_30"],
        allowedMarkets: [],
        allowedHorizons: [],
        allowedLeagueIds: []
      };
    }

    if (profileKey === "AGGRESSIVE") {
      return {
        minConfidence: 0.5,
        minPublishScore: 0.5,
        minEdge: -0.005,
        maxVolatility: 0.45,
        maxProviderDisagreement: 0.35,
        minLineupCoverage: 0.35,
        minEventCoverage: 0.2,
        maxMissingStatsRatio: 0.7,
        minFreshnessScore: 0.3,
        maxPicksPerMatch: 3,
        requireOdds: false,
        valueOnly: false,
        requireLineupHorizons: [],
        allowedMarkets: [],
        allowedHorizons: [],
        allowedLeagueIds: []
      };
    }

    return {
      minConfidence: 0.56,
      minPublishScore: 0.58,
      minEdge: 0,
      maxVolatility: 0.34,
      maxProviderDisagreement: 0.25,
      minLineupCoverage: 0.45,
      minEventCoverage: 0.3,
      maxMissingStatsRatio: 0.55,
      minFreshnessScore: 0.4,
      maxPicksPerMatch: 2,
      requireOdds: true,
      valueOnly: false,
      requireLineupHorizons: ["LINEUP"],
      allowedMarkets: [],
      allowedHorizons: [],
      allowedLeagueIds: []
    };
  }

  private parseProfileConfig(profileKey: StrategyProfileKey, value: Prisma.JsonValue): StrategyProfileConfig {
    const defaults = this.defaultProfileConfig(profileKey);
    const record = this.toRecord(value) ?? {};
    const clamp01 = (candidate: number, fallback: number) => this.clamp(candidate, 0, 1);

    return {
      minConfidence: clamp01(this.toNumber(record.minConfidence, defaults.minConfidence), defaults.minConfidence),
      minPublishScore: clamp01(this.toNumber(record.minPublishScore, defaults.minPublishScore), defaults.minPublishScore),
      minEdge: this.clamp(this.toNumber(record.minEdge, defaults.minEdge), -0.25, 0.5),
      maxVolatility: clamp01(this.toNumber(record.maxVolatility, defaults.maxVolatility), defaults.maxVolatility),
      maxProviderDisagreement: clamp01(
        this.toNumber(record.maxProviderDisagreement, defaults.maxProviderDisagreement),
        defaults.maxProviderDisagreement
      ),
      minLineupCoverage: clamp01(this.toNumber(record.minLineupCoverage, defaults.minLineupCoverage), defaults.minLineupCoverage),
      minEventCoverage: clamp01(this.toNumber(record.minEventCoverage, defaults.minEventCoverage), defaults.minEventCoverage),
      maxMissingStatsRatio: clamp01(
        this.toNumber(record.maxMissingStatsRatio, defaults.maxMissingStatsRatio),
        defaults.maxMissingStatsRatio
      ),
      minFreshnessScore: clamp01(this.toNumber(record.minFreshnessScore, defaults.minFreshnessScore), defaults.minFreshnessScore),
      maxPicksPerMatch: Math.max(1, Math.min(8, Math.floor(this.toNumber(record.maxPicksPerMatch, defaults.maxPicksPerMatch)))),
      requireOdds: this.toBoolean(record.requireOdds, defaults.requireOdds),
      valueOnly: this.toBoolean(record.valueOnly, defaults.valueOnly),
      requireLineupHorizons: this.toStringArray(record.requireLineupHorizons),
      allowedMarkets: this.toStringArray(record.allowedMarkets).map((item) => item.toLowerCase()),
      allowedHorizons: this.toStringArray(record.allowedHorizons).map((item) => item.toUpperCase()),
      allowedLeagueIds: this.toStringArray(record.allowedLeagueIds)
    };
  }

  async ensureDefaults() {
    if (this.defaultsEnsured) {
      return;
    }

    const policy = await this.prisma.publishPolicy.upsert({
      where: { key: SelectionEngineConfigService.POLICY_KEY },
      update: {
        name: "Default Publish Selection Policy",
        isActive: true
      },
      create: {
        key: SelectionEngineConfigService.POLICY_KEY,
        name: "Default Publish Selection Policy",
        description: "Deterministic rule-based publish selection policy",
        isActive: true
      }
    });

    let activeVersion = await this.prisma.publishPolicyVersion.findFirst({
      where: { policyId: policy.id, isActive: true },
      orderBy: [{ version: "desc" }]
    });

    if (!activeVersion) {
      activeVersion = await this.prisma.publishPolicyVersion.create({
        data: {
          policyId: policy.id,
          version: 1,
          label: "v1_deterministic_selector",
          configJson: {
            selector: "deterministic_rule_v1",
            objective: "selection_quality",
            createdAt: new Date().toISOString()
          },
          isActive: true
        }
      });
    }

    if (policy.currentVersionId !== activeVersion.id) {
      await this.prisma.publishPolicy.update({
        where: { id: policy.id },
        data: { currentVersionId: activeVersion.id }
      });
    }

    for (const profileKey of ["CONSERVATIVE", "BALANCED", "AGGRESSIVE"] as const) {
      const existing = await this.prisma.publishStrategyProfile.findFirst({
        where: {
          policyVersionId: activeVersion.id,
          profileKey,
          leagueId: null,
          market: null,
          horizon: null
        }
      });
      if (existing) {
        continue;
      }
      await this.prisma.publishStrategyProfile.create({
        data: {
          policyVersionId: activeVersion.id,
          profileKey,
          name: profileKey,
          configJson: this.defaultProfileConfig(profileKey),
          isDefault: profileKey === "BALANCED",
          isActive: true
        }
      });
    }

    const ensureRule = async (
      marketFamily: string,
      maxPicksPerMatch: number,
      allowMultiHorizon: boolean,
      priority: number
    ) => {
      const exists = await this.prisma.marketConflictRule.findFirst({
        where: {
          policyVersionId: activeVersion.id,
          marketFamily
        }
      });
      if (exists) {
        return;
      }
      await this.prisma.marketConflictRule.create({
        data: {
          policyVersionId: activeVersion.id,
          marketFamily,
          maxPicksPerMatch,
          allowMultiHorizon,
          priority,
          isActive: true,
          suppressCorrelated: true,
          configJson: {}
        }
      });
    };

    await ensureRule("result", 1, false, 10);
    await ensureRule("totals", 2, true, 20);
    await ensureRule("btts", 1, false, 30);
    await ensureRule("score", 1, false, 40);
    await ensureRule("halftime", 1, false, 50);
    await ensureRule("other", 2, true, 99);

    this.defaultsEnsured = true;
  }

  async getEngineSettings(): Promise<SelectionEngineSettings> {
    await this.ensureDefaults();
    const keys = Object.values(SelectionEngineConfigService.SETTINGS_KEYS);
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: { in: keys }
      },
      select: {
        key: true,
        value: true
      }
    });

    const byKey = new Map(rows.map((row) => [row.key, row.value]));

    return {
      enabled: this.toBoolean(byKey.get(SelectionEngineConfigService.SETTINGS_KEYS.enabled), true),
      shadowMode: this.toBoolean(byKey.get(SelectionEngineConfigService.SETTINGS_KEYS.shadowMode), true),
      defaultProfile: this.normalizeProfileKey(
        this.toString(byKey.get(SelectionEngineConfigService.SETTINGS_KEYS.defaultProfile), "BALANCED")
      ),
      emergencyRollback: this.toBoolean(byKey.get(SelectionEngineConfigService.SETTINGS_KEYS.emergencyRollback), false)
    };
  }

  async setEngineSettings(input: Partial<SelectionEngineSettings>) {
    await this.ensureDefaults();
    const writes: Array<Promise<unknown>> = [];
    const upsert = (key: string, value: Prisma.InputJsonValue, description: string) =>
      this.prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value, description }
      });

    if (typeof input.enabled === "boolean") {
      writes.push(upsert(SelectionEngineConfigService.SETTINGS_KEYS.enabled, input.enabled, "Selection engine enable switch"));
    }
    if (typeof input.shadowMode === "boolean") {
      writes.push(
        upsert(
          SelectionEngineConfigService.SETTINGS_KEYS.shadowMode,
          input.shadowMode,
          "Selection engine shadow mode toggle"
        )
      );
    }
    if (input.defaultProfile) {
      writes.push(
        upsert(
          SelectionEngineConfigService.SETTINGS_KEYS.defaultProfile,
          this.normalizeProfileKey(input.defaultProfile),
          "Default strategy profile for publish decision"
        )
      );
    }
    if (typeof input.emergencyRollback === "boolean") {
      writes.push(
        upsert(
          SelectionEngineConfigService.SETTINGS_KEYS.emergencyRollback,
          input.emergencyRollback,
          "Emergency rollback switch for selection engine"
        )
      );
    }

    if (writes.length > 0) {
      await Promise.all(writes);
    }

    return this.getEngineSettings();
  }

  async getActivePolicyVersion(): Promise<ActivePolicyVersion> {
    await this.ensureDefaults();
    const policy = await this.prisma.publishPolicy.findUnique({
      where: { key: SelectionEngineConfigService.POLICY_KEY },
      include: {
        currentVersion: true
      }
    });

    if (!policy || !policy.currentVersion) {
      throw new Error("publish_policy_not_configured");
    }

    return {
      policyId: policy.id,
      policyKey: policy.key,
      versionId: policy.currentVersion.id,
      version: policy.currentVersion.version,
      label: policy.currentVersion.label,
      configJson: policy.currentVersion.configJson
    };
  }

  async resolveStrategyProfile(input: ResolveProfileInput) {
    const [settings, activePolicy] = await Promise.all([this.getEngineSettings(), this.getActivePolicyVersion()]);

    const profiles = await this.prisma.publishStrategyProfile.findMany({
      where: {
        policyVersionId: activePolicy.versionId,
        isActive: true,
        OR: [{ leagueId: null }, { leagueId: input.leagueId ?? undefined }]
      },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }]
    });

    const normalizeMarket = input.market.trim().toLowerCase();
    const normalizeHorizon = input.horizon.trim().toUpperCase();

    const scoreProfile = (profile: {
      profileKey: string;
      leagueId: string | null;
      market: string | null;
      horizon: string | null;
      isDefault: boolean;
    }) => {
      let score = 0;
      if (profile.leagueId && profile.leagueId === input.leagueId) {
        score += 4;
      }
      if (profile.market && profile.market.trim().toLowerCase() === normalizeMarket) {
        score += 2;
      }
      if (profile.horizon && profile.horizon.trim().toUpperCase() === normalizeHorizon) {
        score += 1;
      }
      if (profile.isDefault) {
        score += 0.5;
      }
      if (this.normalizeProfileKey(profile.profileKey) === settings.defaultProfile) {
        score += 0.25;
      }
      return score;
    };

    const candidates = profiles
      .filter((profile) => {
        const marketOk = !profile.market || profile.market.trim().toLowerCase() === normalizeMarket;
        const horizonOk = !profile.horizon || profile.horizon.trim().toUpperCase() === normalizeHorizon;
        const leagueOk = !profile.leagueId || profile.leagueId === input.leagueId;
        return marketOk && horizonOk && leagueOk;
      })
      .sort((left, right) => scoreProfile(right) - scoreProfile(left));

    const selected = candidates[0] ??
      profiles.find((profile) => this.normalizeProfileKey(profile.profileKey) === settings.defaultProfile) ??
      profiles[0];

    if (!selected) {
      const fallbackProfile = this.normalizeProfileKey(settings.defaultProfile);
      return {
        profileKey: fallbackProfile,
        profileConfig: this.defaultProfileConfig(fallbackProfile),
        policyVersionId: activePolicy.versionId,
        policyVersionLabel: activePolicy.label
      };
    }

    const normalizedProfileKey = this.normalizeProfileKey(selected.profileKey);

    return {
      profileKey: normalizedProfileKey,
      profileConfig: this.parseProfileConfig(normalizedProfileKey, selected.configJson),
      policyVersionId: activePolicy.versionId,
      policyVersionLabel: activePolicy.label
    };
  }

  async getConflictRules(policyVersionId: string, marketFamily: string) {
    await this.ensureDefaults();
    return this.prisma.marketConflictRule.findMany({
      where: {
        policyVersionId,
        isActive: true,
        OR: [{ marketFamily }, { marketFamily: "other" }]
      },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
    });
  }

  async resolveManualOverride(input: {
    matchId: string;
    market: string;
    lineKey: string;
    horizon: string;
    selection: string;
  }) {
    await this.ensureDefaults();
    const now = new Date();
    return this.prisma.manualPublishOverride.findFirst({
      where: {
        matchId: input.matchId,
        market: input.market,
        lineKey: input.lineKey,
        horizon: input.horizon,
        active: true,
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          { OR: [{ selection: null }, { selection: input.selection }] }
        ]
      },
      orderBy: [{ createdAt: "desc" }]
    });
  }

  async upsertScopedProfile(input: {
    profileKey: StrategyProfileKey;
    leagueId?: string | null;
    market?: string | null;
    horizon?: string | null;
    config: Partial<StrategyProfileConfig>;
  }) {
    const activePolicy = await this.getActivePolicyVersion();
    const profileKey = this.normalizeProfileKey(input.profileKey);
    const globalBase = this.defaultProfileConfig(profileKey);

    const existing = await this.prisma.publishStrategyProfile.findFirst({
      where: {
        policyVersionId: activePolicy.versionId,
        profileKey,
        leagueId: input.leagueId ?? null,
        market: input.market ?? null,
        horizon: input.horizon ?? null
      }
    });

    const mergedConfig = {
      ...globalBase,
      ...(existing ? this.parseProfileConfig(profileKey, existing.configJson) : {}),
      ...input.config
    } as StrategyProfileConfig;

    if (existing) {
      return this.prisma.publishStrategyProfile.update({
        where: { id: existing.id },
        data: {
          configJson: mergedConfig as Prisma.InputJsonValue,
          isActive: true
        }
      });
    }

    return this.prisma.publishStrategyProfile.create({
      data: {
        policyVersionId: activePolicy.versionId,
        profileKey,
        name: `${profileKey} scoped profile`,
        leagueId: input.leagueId ?? null,
        market: input.market ?? null,
        horizon: input.horizon ?? null,
        configJson: mergedConfig as Prisma.InputJsonValue,
        isDefault: false,
        isActive: true
      }
    });
  }
}
