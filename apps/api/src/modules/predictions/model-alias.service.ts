import { Injectable } from "@nestjs/common";
import { Prisma, ServingAliasType } from "@prisma/client";
import { CacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import { LIFECYCLE_FLAG_KEYS, LifecycleFlags, ServingResolution, ServingScope } from "./model-lifecycle.types";

@Injectable()
export class ModelAliasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService
  ) {}

  lineKey(line: number | null | undefined) {
    if (line === null || line === undefined || !Number.isFinite(line)) {
      return "na";
    }
    return Number(line).toFixed(2);
  }

  scopeLeagueKey(leagueId: string | null | undefined) {
    return leagueId && leagueId.trim().length > 0 ? leagueId.trim() : "global";
  }

  private isModelAliasSchemaMissing(error: unknown) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "P2021" || code === "P2022") {
      return true;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
    return message.includes("model_aliases") && (message.includes("does not exist") || message.includes("unknown"));
  }

  private toBoolean(value: Prisma.JsonValue | unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(normalized)) {
        return true;
      }
      if (["0", "false", "no", "off"].includes(normalized)) {
        return false;
      }
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const candidate = (value as Record<string, unknown>).value;
      return this.toBoolean(candidate, fallback);
    }
    return fallback;
  }

  async getLifecycleFlags(): Promise<LifecycleFlags> {
    const cacheKey = "lifecycle:flags:v1";
    const cached = await this.cache.get<LifecycleFlags>(cacheKey);
    if (cached) {
      return cached;
    }

    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: Object.values(LIFECYCLE_FLAG_KEYS)
        }
      },
      select: {
        key: true,
        value: true
      }
    });
    const map = new Map(rows.map((row) => [row.key, row.value]));
    const flags: LifecycleFlags = {
      championAliasResolutionEnabled: this.toBoolean(map.get(LIFECYCLE_FLAG_KEYS.championAliasResolutionEnabled), true),
      challengerShadowEnabled: this.toBoolean(map.get(LIFECYCLE_FLAG_KEYS.challengerShadowEnabled), true),
      canaryEnabled: this.toBoolean(map.get(LIFECYCLE_FLAG_KEYS.canaryEnabled), false),
      autoPromotionEnabled: this.toBoolean(map.get(LIFECYCLE_FLAG_KEYS.autoPromotionEnabled), false),
      autoRollbackEnabled: this.toBoolean(map.get(LIFECYCLE_FLAG_KEYS.autoRollbackEnabled), false),
      driftTriggeredRetrainingEnabled: this.toBoolean(map.get(LIFECYCLE_FLAG_KEYS.driftTriggeredRetrainingEnabled), true)
    };
    await this.cache.set(cacheKey, flags, 30, ["model-lifecycle"]);
    return flags;
  }

  async setLifecycleFlags(input: Partial<LifecycleFlags>) {
    const writes: Array<Promise<unknown>> = [];
    const upsert = (key: string, value: boolean, description: string) =>
      this.prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value, description }
      });

    if (typeof input.championAliasResolutionEnabled === "boolean") {
      writes.push(
        upsert(
          LIFECYCLE_FLAG_KEYS.championAliasResolutionEnabled,
          input.championAliasResolutionEnabled,
          "Enable alias-based champion model resolution in serving path"
        )
      );
    }
    if (typeof input.challengerShadowEnabled === "boolean") {
      writes.push(
        upsert(
          LIFECYCLE_FLAG_KEYS.challengerShadowEnabled,
          input.challengerShadowEnabled,
          "Enable challenger shadow evaluation"
        )
      );
    }
    if (typeof input.canaryEnabled === "boolean") {
      writes.push(upsert(LIFECYCLE_FLAG_KEYS.canaryEnabled, input.canaryEnabled, "Enable canary alias routing"));
    }
    if (typeof input.autoPromotionEnabled === "boolean") {
      writes.push(
        upsert(LIFECYCLE_FLAG_KEYS.autoPromotionEnabled, input.autoPromotionEnabled, "Enable automatic promotion decisions")
      );
    }
    if (typeof input.autoRollbackEnabled === "boolean") {
      writes.push(
        upsert(LIFECYCLE_FLAG_KEYS.autoRollbackEnabled, input.autoRollbackEnabled, "Enable automatic rollback decisions")
      );
    }
    if (typeof input.driftTriggeredRetrainingEnabled === "boolean") {
      writes.push(
        upsert(
          LIFECYCLE_FLAG_KEYS.driftTriggeredRetrainingEnabled,
          input.driftTriggeredRetrainingEnabled,
          "Enable retraining triggers from drift monitors"
        )
      );
    }

    if (writes.length > 0) {
      await Promise.all(writes);
      await this.cache.invalidateTag("model-lifecycle");
    }

    return this.getLifecycleFlags();
  }

  private async fallbackActiveModel(): Promise<ServingResolution> {
    const activeModel =
      (await this.prisma.modelVersion.findFirst({
        where: { active: true },
        orderBy: { createdAt: "desc" }
      })) ??
      (await this.prisma.modelVersion.findFirst({
        orderBy: { createdAt: "desc" }
      }));

    return {
      aliasType: ServingAliasType.CHAMPION,
      modelVersionId: activeModel?.id ?? null,
      calibrationVersionId: null,
      featureSetVersion: null,
      policyVersion: null,
      scopeLeagueKey: "global",
      resolvedViaAlias: false
    };
  }

  async resolveServingAlias(
    scope: ServingScope,
    options?: {
      aliasType?: ServingAliasType;
    }
  ): Promise<ServingResolution> {
    const flags = await this.getLifecycleFlags();
    if (!flags.championAliasResolutionEnabled) {
      return this.fallbackActiveModel();
    }

    const aliasType = options?.aliasType ?? ServingAliasType.CHAMPION;
    const normalizedScope: ServingScope = {
      ...scope,
      sport: scope.sport.trim().toLowerCase(),
      market: scope.market.trim().toLowerCase(),
      lineKey: this.lineKey(scope.line),
      horizon: scope.horizon.trim().toUpperCase(),
      leagueId: scope.leagueId ?? null
    };
    const leagueScopeKey = this.scopeLeagueKey(normalizedScope.leagueId);
    const cacheKey = `lifecycle:alias:${normalizedScope.sport}:${normalizedScope.market}:${normalizedScope.lineKey}:${normalizedScope.horizon}:${leagueScopeKey}:${aliasType}`;
    const cached = await this.cache.get<ServingResolution>(cacheKey);
    if (cached) {
      return cached;
    }

    let candidates: Array<{
      aliasType: ServingAliasType;
      modelVersionId: string;
      calibrationVersionId: string | null;
      featureSetVersion: string | null;
      policyVersion: string | null;
      scopeLeagueKey: string;
    }> = [];
    try {
      candidates = await this.prisma.modelAlias.findMany({
        where: {
          sportCode: normalizedScope.sport,
          market: normalizedScope.market,
          lineKey: normalizedScope.lineKey,
          horizon: normalizedScope.horizon,
          aliasType,
          isActive: true,
          scopeLeagueKey: { in: [leagueScopeKey, "global"] }
        },
        orderBy: [{ scopeLeagueKey: "desc" }, { updatedAt: "desc" }]
      });
    } catch (error) {
      if (!this.isModelAliasSchemaMissing(error)) {
        throw error;
      }
      const fallback = await this.fallbackActiveModel();
      await this.cache.set(cacheKey, fallback, 30, ["model-lifecycle"]);
      return fallback;
    }

    const selected =
      candidates.find((item) => item.scopeLeagueKey === leagueScopeKey) ??
      candidates.find((item) => item.scopeLeagueKey === "global") ??
      null;

    if (!selected) {
      const fallback = await this.fallbackActiveModel();
      await this.cache.set(cacheKey, fallback, 30, ["model-lifecycle"]);
      return fallback;
    }

    const output: ServingResolution = {
      aliasType: selected.aliasType,
      modelVersionId: selected.modelVersionId,
      calibrationVersionId: selected.calibrationVersionId ?? null,
      featureSetVersion: selected.featureSetVersion ?? null,
      policyVersion: selected.policyVersion ?? null,
      scopeLeagueKey: selected.scopeLeagueKey,
      resolvedViaAlias: true
    };
    await this.cache.set(cacheKey, output, 30, ["model-lifecycle"]);
    return output;
  }

  async switchAlias(input: {
    sport: string;
    market: string;
    line: number | null;
    horizon: string;
    leagueId?: string | null;
    aliasType: ServingAliasType;
    modelVersionId: string;
    calibrationVersionId?: string | null;
    featureSetVersion?: string | null;
    policyVersion?: string | null;
    actor?: string;
    reason?: string | null;
    effectiveAt?: Date | null;
  }) {
    const line = input.line ?? null;
    const lineKey = this.lineKey(line);
    const scopeLeagueKey = this.scopeLeagueKey(input.leagueId ?? null);
    const now = new Date();
    const updated = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.modelAlias.findUnique({
        where: {
          sportCode_market_lineKey_horizon_scopeLeagueKey_aliasType: {
            sportCode: input.sport.trim().toLowerCase(),
            market: input.market.trim().toLowerCase(),
            lineKey,
            horizon: input.horizon.trim().toUpperCase(),
            scopeLeagueKey,
            aliasType: input.aliasType
          }
        }
      });

      const alias = await tx.modelAlias.upsert({
        where: {
          sportCode_market_lineKey_horizon_scopeLeagueKey_aliasType: {
            sportCode: input.sport.trim().toLowerCase(),
            market: input.market.trim().toLowerCase(),
            lineKey,
            horizon: input.horizon.trim().toUpperCase(),
            scopeLeagueKey,
            aliasType: input.aliasType
          }
        },
        update: {
          line,
          leagueId: input.leagueId ?? null,
          modelVersionId: input.modelVersionId,
          calibrationVersionId: input.calibrationVersionId ?? null,
          featureSetVersion: input.featureSetVersion ?? null,
          policyVersion: input.policyVersion ?? null,
          isActive: true,
          actor: input.actor ?? "system",
          effectiveAt: input.effectiveAt ?? now,
          detailsJson: {
            reason: input.reason ?? null
          } as Prisma.InputJsonValue
        },
        create: {
          sportCode: input.sport.trim().toLowerCase(),
          market: input.market.trim().toLowerCase(),
          line,
          lineKey,
          horizon: input.horizon.trim().toUpperCase(),
          leagueId: input.leagueId ?? null,
          scopeLeagueKey,
          aliasType: input.aliasType,
          modelVersionId: input.modelVersionId,
          calibrationVersionId: input.calibrationVersionId ?? null,
          featureSetVersion: input.featureSetVersion ?? null,
          policyVersion: input.policyVersion ?? null,
          actor: input.actor ?? "system",
          effectiveAt: input.effectiveAt ?? now,
          detailsJson: {
            reason: input.reason ?? null
          } as Prisma.InputJsonValue
        }
      });

      await tx.servingAliasHistory.create({
        data: {
          modelAliasId: alias.id,
          previousModelVersionId: existing?.modelVersionId ?? null,
          newModelVersionId: alias.modelVersionId,
          previousCalibrationVersionId: existing?.calibrationVersionId ?? null,
          newCalibrationVersionId: alias.calibrationVersionId ?? null,
          actor: input.actor ?? "system",
          reason: input.reason ?? null,
          effectiveAt: input.effectiveAt ?? now,
          metadataJson: {
            aliasType: input.aliasType,
            sport: input.sport,
            market: input.market,
            lineKey,
            horizon: input.horizon
          } as Prisma.InputJsonValue
        }
      });

      return alias;
    });

    await this.cache.invalidateTag("model-lifecycle");
    return updated;
  }
}
