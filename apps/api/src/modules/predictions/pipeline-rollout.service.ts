import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

type RolloutSettings = {
  mode: "legacy" | "new" | "shadow" | "percentage";
  percentage: number;
  internalOnly: boolean;
  emergencyRollback: boolean;
};

type ResolveSourceInput = {
  seed: string;
  isInternalRequest?: boolean;
};

@Injectable()
export class PipelineRolloutService {
  private static readonly MODE_KEY = "pipeline.rollout.mode";
  private static readonly PERCENTAGE_KEY = "pipeline.rollout.percentage";
  private static readonly INTERNAL_ONLY_KEY = "pipeline.rollout.internal_only";
  private static readonly EMERGENCY_ROLLBACK_KEY = "pipeline.rollout.emergency_rollback";

  constructor(private readonly prisma: PrismaService) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private parseJsonValue<T>(value: Prisma.JsonValue | null, fallback: T) {
    if (value === null || value === undefined) {
      return fallback;
    }
    if (typeof fallback === "number") {
      const numeric = typeof value === "number" ? value : Number(value);
      return (Number.isFinite(numeric) ? numeric : fallback) as T;
    }
    if (typeof fallback === "boolean") {
      if (typeof value === "boolean") {
        return value as T;
      }
      if (typeof value === "string") {
        const token = value.toLowerCase();
        if (token === "true" || token === "1") {
          return true as T;
        }
        if (token === "false" || token === "0") {
          return false as T;
        }
      }
      return fallback;
    }
    if (typeof fallback === "string") {
      if (typeof value === "string") {
        return value as T;
      }
      return fallback;
    }
    return fallback;
  }

  private hashSeed(seed: string) {
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 33 + seed.charCodeAt(i)) % 10000;
    }
    return hash / 100;
  }

  async getSettings(): Promise<RolloutSettings> {
    const rows = await this.prisma.systemSetting.findMany({
      where: {
        key: {
          in: [
            PipelineRolloutService.MODE_KEY,
            PipelineRolloutService.PERCENTAGE_KEY,
            PipelineRolloutService.INTERNAL_ONLY_KEY,
            PipelineRolloutService.EMERGENCY_ROLLBACK_KEY
          ]
        }
      }
    });
    const byKey = new Map(rows.map((row) => [row.key, row.value]));
    const modeRaw = this.parseJsonValue(byKey.get(PipelineRolloutService.MODE_KEY) ?? null, "new");
    const mode = ["legacy", "new", "shadow", "percentage"].includes(modeRaw)
      ? (modeRaw as RolloutSettings["mode"])
      : "new";
    return {
      mode,
      percentage: this.clamp(
        this.parseJsonValue(byKey.get(PipelineRolloutService.PERCENTAGE_KEY) ?? null, 100),
        0,
        100
      ),
      internalOnly: this.parseJsonValue(byKey.get(PipelineRolloutService.INTERNAL_ONLY_KEY) ?? null, false),
      emergencyRollback: this.parseJsonValue(byKey.get(PipelineRolloutService.EMERGENCY_ROLLBACK_KEY) ?? null, false)
    };
  }

  async setSettings(input: Partial<RolloutSettings>) {
    const writeOps: Array<Promise<unknown>> = [];
    const upsert = (key: string, value: Prisma.InputJsonValue, description: string) =>
      this.prisma.systemSetting.upsert({
        where: { key },
        update: { value },
        create: { key, value, description }
      });

    if (input.mode) {
      writeOps.push(
        upsert(
          PipelineRolloutService.MODE_KEY,
          input.mode,
          "Prediction pipeline source mode: legacy | new | shadow | percentage"
        )
      );
    }
    if (typeof input.percentage === "number" && Number.isFinite(input.percentage)) {
      writeOps.push(
        upsert(
          PipelineRolloutService.PERCENTAGE_KEY,
          this.clamp(input.percentage, 0, 100),
          "Traffic percentage for new pipeline when mode=percentage"
        )
      );
    }
    if (typeof input.internalOnly === "boolean") {
      writeOps.push(
        upsert(
          PipelineRolloutService.INTERNAL_ONLY_KEY,
          input.internalOnly,
          "If true, percentage rollout applies only to internal requests"
        )
      );
    }
    if (typeof input.emergencyRollback === "boolean") {
      writeOps.push(
        upsert(
          PipelineRolloutService.EMERGENCY_ROLLBACK_KEY,
          input.emergencyRollback,
          "Emergency rollback switch to force legacy source"
        )
      );
    }

    if (writeOps.length > 0) {
      await Promise.all(writeOps);
    }
    return this.getSettings();
  }

  async resolveSource(input: ResolveSourceInput): Promise<"legacy" | "published"> {
    const settings = await this.getSettings();
    if (settings.emergencyRollback || settings.mode === "legacy") {
      return "legacy";
    }
    if (settings.mode === "new" || settings.mode === "shadow") {
      return "published";
    }
    if (settings.internalOnly && !input.isInternalRequest) {
      return "legacy";
    }
    const bucket = this.hashSeed(input.seed);
    return bucket < settings.percentage ? "published" : "legacy";
  }
}
