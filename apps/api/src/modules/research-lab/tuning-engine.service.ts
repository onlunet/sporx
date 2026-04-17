import { Injectable } from "@nestjs/common";
import { TuningSearchType } from "@prisma/client";
import { stableHash } from "./research-lab.hash";
import { TrialPlan, TuningSearchSpaceDefinition } from "./research-lab.types";

type BuildTrialPlanInput = {
  experimentId: string;
  runId: string;
  baseSeed: number;
  searchSpace: TuningSearchSpaceDefinition;
};

@Injectable()
export class TuningEngineService {
  private normalizeSeed(seed: number) {
    const normalized = Math.floor(Math.abs(seed)) % 2147483647;
    return normalized > 0 ? normalized : 1;
  }

  private next(seed: number) {
    return (seed * 48271) % 2147483647;
  }

  private randomFloat(seed: number) {
    const nextSeed = this.next(seed);
    return { seed: nextSeed, value: nextSeed / 2147483647 };
  }

  private randomBetween(seed: number, min: number, max: number, step = 0) {
    const sampled = this.randomFloat(seed);
    const raw = min + sampled.value * (max - min);
    if (step <= 0) {
      return { seed: sampled.seed, value: Number(raw.toFixed(8)) };
    }
    const bucket = Math.round((raw - min) / step);
    return {
      seed: sampled.seed,
      value: Number((min + bucket * step).toFixed(8))
    };
  }

  private gridCombinations(grid: Record<string, number[]>) {
    const keys = Object.keys(grid).sort();
    if (keys.length === 0) {
      return [] as Array<Record<string, number>>;
    }
    const combinations: Array<Record<string, number>> = [];
    const walk = (index: number, current: Record<string, number>) => {
      if (index >= keys.length) {
        combinations.push({ ...current });
        return;
      }
      const key = keys[index];
      const values = [...(grid[key] ?? [])].filter((value) => Number.isFinite(value));
      if (values.length === 0) {
        walk(index + 1, current);
        return;
      }
      for (const value of values) {
        current[key] = Number(value);
        walk(index + 1, current);
      }
      delete current[key];
    };
    walk(0, {});
    return combinations;
  }

  buildTrialPlan(input: BuildTrialPlanInput): TrialPlan[] {
    const searchType = input.searchSpace.type;
    const seedBase = this.normalizeSeed(input.baseSeed);
    const maxTrials = Math.max(1, Math.min(500, Math.floor(input.searchSpace.maxTrials ?? 40)));

    if (searchType === TuningSearchType.GRID) {
      const combinations = this.gridCombinations(input.searchSpace.grid ?? {});
      const capped = combinations.slice(0, maxTrials);
      return capped.map((config, index) => {
        const trialSeed = this.normalizeSeed(seedBase + index + 1);
        const configHash = stableHash(config);
        return {
          trialNumber: index + 1,
          trialKey: stableHash({
            runId: input.runId,
            experimentId: input.experimentId,
            trialNumber: index + 1,
            seed: trialSeed,
            configHash
          }),
          seed: trialSeed,
          config,
          configHash
        };
      });
    }

    const randomSpec = input.searchSpace.random ?? {};
    const keys = Object.keys(randomSpec).sort();
    let currentSeed = seedBase;
    const trials: TrialPlan[] = [];
    for (let index = 0; index < maxTrials; index += 1) {
      const config: Record<string, number> = {};
      for (const key of keys) {
        const spec = randomSpec[key];
        if (!spec || !Number.isFinite(spec.min) || !Number.isFinite(spec.max) || spec.max <= spec.min) {
          continue;
        }
        const sampled = this.randomBetween(currentSeed, spec.min, spec.max, spec.step ?? 0);
        currentSeed = sampled.seed;
        config[key] = sampled.value;
      }
      const trialSeed = this.normalizeSeed(seedBase + index + 1);
      const configHash = stableHash(config);
      trials.push({
        trialNumber: index + 1,
        trialKey: stableHash({
          runId: input.runId,
          experimentId: input.experimentId,
          searchType,
          trialNumber: index + 1,
          seed: trialSeed,
          configHash
        }),
        seed: trialSeed,
        config,
        configHash
      });
    }
    return trials;
  }
}
