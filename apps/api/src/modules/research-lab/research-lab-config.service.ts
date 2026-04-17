import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ResearchSettings } from "./research-lab.types";

@Injectable()
export class ResearchLabConfigService {
  private static readonly SETTINGS = {
    researchLabEnabled: "research_lab_enabled",
    autoTuningEnabled: "auto_tuning_enabled",
    trialPruningEnabled: "trial_pruning_enabled",
    policyCandidateRegistryEnabled: "policy_candidate_registry_enabled",
    policyShadowPromotionEnabled: "policy_shadow_promotion_enabled",
    policyCanaryPromotionEnabled: "policy_canary_promotion_enabled"
  } as const;

  private defaultsEnsured = false;

  constructor(private readonly prisma: PrismaService) {}

  private toBoolean(value: Prisma.JsonValue | null | undefined, fallback: boolean): boolean {
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number") {
      return value !== 0;
    }
    if (typeof value === "string") {
      const token = value.trim().toLowerCase();
      if (["1", "true", "yes", "on"].includes(token)) {
        return true;
      }
      if (["0", "false", "no", "off"].includes(token)) {
        return false;
      }
    }
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return this.toBoolean((value as Record<string, Prisma.JsonValue>).value, fallback);
    }
    return fallback;
  }

  private async upsertSetting(key: string, value: Prisma.InputJsonValue, description: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value, description }
    });
  }

  async ensureDefaults() {
    if (this.defaultsEnsured) {
      return;
    }

    await this.upsertSetting(ResearchLabConfigService.SETTINGS.researchLabEnabled, true, "Enable research lab module");
    await this.upsertSetting(
      ResearchLabConfigService.SETTINGS.autoTuningEnabled,
      false,
      "Enable auto tuning in internal research mode"
    );
    await this.upsertSetting(
      ResearchLabConfigService.SETTINGS.trialPruningEnabled,
      true,
      "Enable deterministic early pruning"
    );
    await this.upsertSetting(
      ResearchLabConfigService.SETTINGS.policyCandidateRegistryEnabled,
      true,
      "Enable policy candidate registry"
    );
    await this.upsertSetting(
      ResearchLabConfigService.SETTINGS.policyShadowPromotionEnabled,
      false,
      "Enable policy shadow promotion step"
    );
    await this.upsertSetting(
      ResearchLabConfigService.SETTINGS.policyCanaryPromotionEnabled,
      false,
      "Enable policy canary promotion step"
    );

    this.defaultsEnsured = true;
  }

  async getSettings(): Promise<ResearchSettings> {
    await this.ensureDefaults();
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: Object.values(ResearchLabConfigService.SETTINGS)
        }
      }
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    return {
      researchLabEnabled: this.toBoolean(byKey.get(ResearchLabConfigService.SETTINGS.researchLabEnabled), true),
      autoTuningEnabled: this.toBoolean(byKey.get(ResearchLabConfigService.SETTINGS.autoTuningEnabled), false),
      trialPruningEnabled: this.toBoolean(byKey.get(ResearchLabConfigService.SETTINGS.trialPruningEnabled), true),
      policyCandidateRegistryEnabled: this.toBoolean(
        byKey.get(ResearchLabConfigService.SETTINGS.policyCandidateRegistryEnabled),
        true
      ),
      policyShadowPromotionEnabled: this.toBoolean(
        byKey.get(ResearchLabConfigService.SETTINGS.policyShadowPromotionEnabled),
        false
      ),
      policyCanaryPromotionEnabled: this.toBoolean(
        byKey.get(ResearchLabConfigService.SETTINGS.policyCanaryPromotionEnabled),
        false
      )
    };
  }

  async setSettings(input: Partial<ResearchSettings>) {
    await this.ensureDefaults();
    const writes: Array<Promise<unknown>> = [];
    const maybeWrite = (key: string, value: boolean | undefined, description: string) => {
      if (typeof value === "boolean") {
        writes.push(this.upsertSetting(key, value, description));
      }
    };

    maybeWrite(
      ResearchLabConfigService.SETTINGS.researchLabEnabled,
      input.researchLabEnabled,
      "Enable research lab module"
    );
    maybeWrite(
      ResearchLabConfigService.SETTINGS.autoTuningEnabled,
      input.autoTuningEnabled,
      "Enable auto tuning in internal research mode"
    );
    maybeWrite(
      ResearchLabConfigService.SETTINGS.trialPruningEnabled,
      input.trialPruningEnabled,
      "Enable deterministic early pruning"
    );
    maybeWrite(
      ResearchLabConfigService.SETTINGS.policyCandidateRegistryEnabled,
      input.policyCandidateRegistryEnabled,
      "Enable policy candidate registry"
    );
    maybeWrite(
      ResearchLabConfigService.SETTINGS.policyShadowPromotionEnabled,
      input.policyShadowPromotionEnabled,
      "Enable policy shadow promotion step"
    );
    maybeWrite(
      ResearchLabConfigService.SETTINGS.policyCanaryPromotionEnabled,
      input.policyCanaryPromotionEnabled,
      "Enable policy canary promotion step"
    );

    if (writes.length > 0) {
      await Promise.all(writes);
    }

    return this.getSettings();
  }

  getSettingKeyMap() {
    return { ...ResearchLabConfigService.SETTINGS };
  }
}
