import { Injectable } from "@nestjs/common";
import { BankrollProfileKey, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { BankrollSettings, StakingProfileConfig } from "./bankroll.types";

@Injectable()
export class BankrollConfigService {
  private static readonly SETTINGS = {
    bankrollLayerEnabled: "bankroll_layer_enabled",
    paperExecutionEnabled: "paper_execution_enabled",
    stakingProfileDefault: "staking_profile_default",
    correlationChecksEnabled: "correlation_checks_enabled",
    exposureGovernanceEnabled: "exposure_governance_enabled",
    roiGovernanceEnabled: "roi_governance_enabled",
    researchModeMultilegEnabled: "research_mode_multileg_enabled",
    emergencyKillSwitch: "bankroll_emergency_kill_switch"
  } as const;

  private defaultsEnsured = false;

  constructor(private readonly prisma: PrismaService) {}

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

  private normalizeProfile(value: string): BankrollProfileKey {
    const token = value.trim().toUpperCase();
    if (
      token === BankrollProfileKey.FLAT_UNIT ||
      token === BankrollProfileKey.FRACTIONAL_KELLY ||
      token === BankrollProfileKey.CAPPED_FRACTIONAL_KELLY ||
      token === BankrollProfileKey.RISK_BUDGETED
    ) {
      return token;
    }
    return BankrollProfileKey.CAPPED_FRACTIONAL_KELLY;
  }

  private profileConfigDefaults(profile: BankrollProfileKey): StakingProfileConfig {
    if (profile === BankrollProfileKey.FLAT_UNIT) {
      return {
        kellyFraction: 0,
        hardMaxFractionPerBet: 0.02,
        minStake: 1,
        maxStake: 150,
        minEdge: 0.002,
        minConfidence: 0.52,
        minPublishScore: 0.56,
        flatUnit: 10,
        riskBudgetFraction: 0.02
      };
    }

    if (profile === BankrollProfileKey.FRACTIONAL_KELLY) {
      return {
        kellyFraction: 0.33,
        hardMaxFractionPerBet: 0.05,
        minStake: 1,
        maxStake: 250,
        minEdge: 0.003,
        minConfidence: 0.54,
        minPublishScore: 0.58,
        flatUnit: 10,
        riskBudgetFraction: 0.03
      };
    }

    if (profile === BankrollProfileKey.RISK_BUDGETED) {
      return {
        kellyFraction: 0.2,
        hardMaxFractionPerBet: 0.03,
        minStake: 1,
        maxStake: 180,
        minEdge: 0.004,
        minConfidence: 0.55,
        minPublishScore: 0.6,
        flatUnit: 10,
        riskBudgetFraction: 0.015
      };
    }

    return {
      kellyFraction: 0.25,
      hardMaxFractionPerBet: 0.03,
      minStake: 1,
      maxStake: 200,
      minEdge: 0.005,
      minConfidence: 0.56,
      minPublishScore: 0.6,
      flatUnit: 10,
      riskBudgetFraction: 0.02
    };
  }

  private parseProfileConfig(profile: BankrollProfileKey, configJson: Prisma.JsonValue): StakingProfileConfig {
    const defaults = this.profileConfigDefaults(profile);
    const record = this.toRecord(configJson) ?? {};

    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

    return {
      kellyFraction: clamp(this.toNumber(record.kellyFraction, defaults.kellyFraction), 0, 1),
      hardMaxFractionPerBet: clamp(this.toNumber(record.hardMaxFractionPerBet, defaults.hardMaxFractionPerBet), 0, 0.25),
      minStake: clamp(this.toNumber(record.minStake, defaults.minStake), 0.1, 5_000),
      maxStake: clamp(this.toNumber(record.maxStake, defaults.maxStake), 1, 100_000),
      minEdge: clamp(this.toNumber(record.minEdge, defaults.minEdge), -0.2, 0.5),
      minConfidence: clamp(this.toNumber(record.minConfidence, defaults.minConfidence), 0, 1),
      minPublishScore: clamp(this.toNumber(record.minPublishScore, defaults.minPublishScore), 0, 1),
      flatUnit: clamp(this.toNumber(record.flatUnit, defaults.flatUnit), 0.1, 10_000),
      riskBudgetFraction: clamp(this.toNumber(record.riskBudgetFraction, defaults.riskBudgetFraction), 0, 0.25)
    };
  }

  private async upsertSetting(key: string, value: Prisma.InputJsonValue, description: string) {
    await this.prisma.systemSetting.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description }
    });
  }

  async ensureDefaults() {
    if (this.defaultsEnsured) {
      return;
    }

    await this.upsertSetting(BankrollConfigService.SETTINGS.bankrollLayerEnabled, true, "Enable internal bankroll layer");
    await this.upsertSetting(BankrollConfigService.SETTINGS.paperExecutionEnabled, true, "Enable paper execution only");
    await this.upsertSetting(
      BankrollConfigService.SETTINGS.stakingProfileDefault,
      BankrollProfileKey.CAPPED_FRACTIONAL_KELLY,
      "Default staking profile key"
    );
    await this.upsertSetting(BankrollConfigService.SETTINGS.correlationChecksEnabled, true, "Enable deterministic correlation checks");
    await this.upsertSetting(BankrollConfigService.SETTINGS.exposureGovernanceEnabled, true, "Enable exposure governance checks");
    await this.upsertSetting(BankrollConfigService.SETTINGS.roiGovernanceEnabled, true, "Enable ROI governance checks");
    await this.upsertSetting(BankrollConfigService.SETTINGS.researchModeMultilegEnabled, false, "Research-only multi-leg mode");
    await this.upsertSetting(BankrollConfigService.SETTINGS.emergencyKillSwitch, false, "Emergency kill switch for bankroll flow");

    const existingAccount = await this.prisma.bankrollAccount.findFirst({
      where: { name: "Default Paper Account" },
      orderBy: { createdAt: "asc" }
    });

    const account = existingAccount
      ? await this.prisma.bankrollAccount.update({
          where: { id: existingAccount.id },
          data: {
            mode: "PAPER",
            profileDefault: "CAPPED_FRACTIONAL_KELLY"
          }
        })
      : await this.prisma.bankrollAccount.create({
          data: {
            name: "Default Paper Account",
            mode: "PAPER",
            baseCurrency: "USD",
            profileDefault: "CAPPED_FRACTIONAL_KELLY",
            startingBalance: 1000,
            availableBalance: 1000,
            reservedBalance: 0,
            realizedPnl: 0,
            unrealizedExposure: 0,
            metadataJson: {
              source: "system_default"
            }
          }
        });

    const policy = await this.prisma.stakingPolicy.upsert({
      where: { key: "default_paper_staking" },
      update: {
        name: "Default Paper Staking Policy",
        isActive: true
      },
      create: {
        key: "default_paper_staking",
        name: "Default Paper Staking Policy",
        description: "Deterministic capped fractional Kelly policy",
        isActive: true
      }
    });

    let activeVersion = await this.prisma.stakingPolicyVersion.findFirst({
      where: {
        stakingPolicyId: policy.id,
        isActive: true
      },
      orderBy: { version: "desc" }
    });

    if (!activeVersion) {
      activeVersion = await this.prisma.stakingPolicyVersion.create({
        data: {
          stakingPolicyId: policy.id,
          version: 1,
          label: "v1_capped_fractional_kelly",
          configJson: {
            defaultProfile: "CAPPED_FRACTIONAL_KELLY",
            profiles: {
              FLAT_UNIT: this.profileConfigDefaults(BankrollProfileKey.FLAT_UNIT),
              FRACTIONAL_KELLY: this.profileConfigDefaults(BankrollProfileKey.FRACTIONAL_KELLY),
              CAPPED_FRACTIONAL_KELLY: this.profileConfigDefaults(BankrollProfileKey.CAPPED_FRACTIONAL_KELLY),
              RISK_BUDGETED: this.profileConfigDefaults(BankrollProfileKey.RISK_BUDGETED)
            }
          },
          isActive: true
        }
      });
    }

    if (policy.currentVersionId !== activeVersion.id) {
      await this.prisma.stakingPolicy.update({
        where: { id: policy.id },
        data: {
          currentVersionId: activeVersion.id
        }
      });
    }

    const existingProfiles = await this.prisma.bankrollProfileVersion.findMany({
      where: {
        bankrollAccountId: account.id,
        isActive: true
      }
    });

    if (existingProfiles.length === 0) {
      for (const profile of [
        BankrollProfileKey.FLAT_UNIT,
        BankrollProfileKey.FRACTIONAL_KELLY,
        BankrollProfileKey.CAPPED_FRACTIONAL_KELLY,
        BankrollProfileKey.RISK_BUDGETED
      ]) {
        await this.prisma.bankrollProfileVersion.create({
          data: {
            bankrollAccountId: account.id,
            profileKey: profile,
            version: 1,
            configJson: this.profileConfigDefaults(profile),
            isActive: true
          }
        });
      }
    }

    const existingExposureRules = await this.prisma.exposureLimit.count({
      where: {
        bankrollAccountId: account.id,
        isActive: true
      }
    });

    if (existingExposureRules === 0) {
      const defaults: Array<Prisma.ExposureLimitCreateManyInput> = [
        {
          bankrollAccountId: account.id,
          scopeType: "MATCH",
          scopeKey: "*",
          behavior: "CLIP",
          maxFraction: 0.03,
          maxAmount: null,
          configJson: { note: "max 3% bankroll per match" },
          isActive: true
        },
        {
          bankrollAccountId: account.id,
          scopeType: "OPEN_TOTAL",
          scopeKey: "*",
          behavior: "BLOCK",
          maxFraction: 0.2,
          maxAmount: null,
          configJson: { note: "max 20% open exposure" },
          isActive: true
        },
        {
          bankrollAccountId: account.id,
          scopeType: "CONCURRENT_OPEN",
          scopeKey: "*",
          behavior: "BLOCK",
          maxFraction: null,
          maxAmount: 30,
          configJson: { note: "max 30 concurrent open tickets" },
          isActive: true
        },
        {
          bankrollAccountId: account.id,
          scopeType: "CALENDAR_DAY",
          scopeKey: "*",
          behavior: "BLOCK",
          maxFraction: 0.1,
          maxAmount: null,
          configJson: { note: "daily stop-loss max 10% bankroll" },
          isActive: true
        }
      ];

      await this.prisma.exposureLimit.createMany({
        data: defaults
      });
    }

    const existingGovernanceRules = await this.prisma.roiGovernanceRule.count({
      where: {
        bankrollAccountId: account.id,
        isActive: true
      }
    });

    if (existingGovernanceRules === 0) {
      await this.prisma.roiGovernanceRule.createMany({
        data: [
          {
            bankrollAccountId: account.id,
            ruleKey: "max_drawdown",
            targetStatus: "THROTTLED",
            configJson: {
              warn: 0.15,
              block: 0.25
            },
            isActive: true
          },
          {
            bankrollAccountId: account.id,
            ruleKey: "risk_of_ruin",
            targetStatus: "WATCH",
            configJson: {
              warn: 0.08,
              block: 0.18
            },
            isActive: true
          }
        ]
      });
    }

    this.defaultsEnsured = true;
  }

  async getSettings(): Promise<BankrollSettings> {
    await this.ensureDefaults();
    const keys = Object.values(BankrollConfigService.SETTINGS);
    const settings = await this.prisma.systemSetting.findMany({
      where: {
        key: { in: keys }
      }
    });
    const map = new Map(settings.map((item) => [item.key, item.value] as const));

    return {
      bankrollLayerEnabled: this.toBoolean(map.get(BankrollConfigService.SETTINGS.bankrollLayerEnabled), true),
      paperExecutionEnabled: this.toBoolean(map.get(BankrollConfigService.SETTINGS.paperExecutionEnabled), true),
      stakingProfileDefault: this.normalizeProfile(
        this.toString(
          map.get(BankrollConfigService.SETTINGS.stakingProfileDefault),
          BankrollProfileKey.CAPPED_FRACTIONAL_KELLY
        )
      ),
      correlationChecksEnabled: this.toBoolean(map.get(BankrollConfigService.SETTINGS.correlationChecksEnabled), true),
      exposureGovernanceEnabled: this.toBoolean(map.get(BankrollConfigService.SETTINGS.exposureGovernanceEnabled), true),
      roiGovernanceEnabled: this.toBoolean(map.get(BankrollConfigService.SETTINGS.roiGovernanceEnabled), true),
      researchModeMultilegEnabled: this.toBoolean(map.get(BankrollConfigService.SETTINGS.researchModeMultilegEnabled), false),
      emergencyKillSwitch: this.toBoolean(map.get(BankrollConfigService.SETTINGS.emergencyKillSwitch), false)
    };
  }

  async resolvePrimaryAccount() {
    await this.ensureDefaults();
    const account = await this.prisma.bankrollAccount.findFirst({
      where: {
        mode: {
          in: ["PAPER", "SANDBOX"]
        }
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "asc" }]
    });

    if (!account) {
      throw new Error("bankroll_account_not_found");
    }

    return account;
  }

  async resolveActivePolicyVersion() {
    await this.ensureDefaults();

    const policy = await this.prisma.stakingPolicy.findFirst({
      where: {
        key: "default_paper_staking",
        isActive: true
      },
      include: {
        currentVersion: true
      }
    });

    if (!policy?.currentVersion) {
      throw new Error("staking_policy_version_not_found");
    }

    return policy.currentVersion;
  }

  async resolveProfileConfig(profile: BankrollProfileKey, accountId: string, fallbackConfig: Prisma.JsonValue) {
    const accountProfile = await this.prisma.bankrollProfileVersion.findFirst({
      where: {
        bankrollAccountId: accountId,
        profileKey: profile,
        isActive: true
      },
      orderBy: { version: "desc" }
    });

    if (accountProfile) {
      return this.parseProfileConfig(profile, accountProfile.configJson);
    }

    return this.parseProfileConfig(profile, fallbackConfig);
  }

  async resolvePolicyAndProfile(accountId: string, profile: BankrollProfileKey) {
    const policyVersion = await this.resolveActivePolicyVersion();
    const policyConfig = this.toRecord(policyVersion.configJson) ?? {};
    const profileMap = this.toRecord(policyConfig.profiles) ?? {};
    const fallbackConfig = profileMap[profile] as Prisma.JsonValue | undefined;

    return {
      policyVersion,
      profileConfig: await this.resolveProfileConfig(
        profile,
        accountId,
        (fallbackConfig ?? this.profileConfigDefaults(profile)) as Prisma.JsonValue
      )
    };
  }
}
