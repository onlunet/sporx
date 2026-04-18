export type FootballCompetitionBucket = "HOT" | "WARM" | "COLD";

export type FootballSchedulerMode =
  | "fixtures"
  | "fixtures_hot_pulse"
  | "results"
  | "results_reconcile"
  | "standings";

export type FootballCompetitionSignals = {
  hasLive: boolean;
  hasKickoffInNext6Hours: boolean;
  hasKickoffIn6To24Hours: boolean;
  hasRecentFinishedAwaitingReconciliation: boolean;
};

export type FootballBudgetInput = {
  hardLimitPerMinute: number;
  plannedTargetPerMinute: number;
  reservePerMinute: number;
  remainingHeader?: number;
  hadRecent429?: boolean;
};

export type FootballBudgetOutput = {
  hardLimitPerMinute: number;
  reserveCalls: number;
  plannedCalls: number;
};

export type FootballCompetitionSelectionInput = {
  mode: FootballSchedulerMode;
  competitionCodes: string[];
  signalsByCode: Record<string, FootballCompetitionSignals | undefined>;
  lastPolledAtByCode: Record<string, Date | null | undefined>;
  now: Date;
  plannedCalls: number;
  maxCallsCap: number;
  allowFullCycleWhenSafe?: boolean;
  forceIncludeAtLeastOne?: boolean;
};

export type FootballCompetitionSelectionOutput = {
  selectedCompetitionCodes: string[];
  deferredCompetitionCodes: string[];
  bucketByCompetitionCode: Record<string, FootballCompetitionBucket>;
  dueByCompetitionCode: Record<string, boolean>;
  cadenceByCompetitionCodeMinutes: Record<string, number>;
  bucketSizes: {
    hot: number;
    warm: number;
    cold: number;
  };
  selectedCounts: {
    hot: number;
    warm: number;
    cold: number;
  };
};

function bucketPriority(bucket: FootballCompetitionBucket) {
  if (bucket === "HOT") {
    return 0;
  }
  if (bucket === "WARM") {
    return 1;
  }
  return 2;
}

export function classifyFootballCompetitionBucket(input: FootballCompetitionSignals): FootballCompetitionBucket {
  if (input.hasLive || input.hasKickoffInNext6Hours) {
    return "HOT";
  }
  if (input.hasKickoffIn6To24Hours || input.hasRecentFinishedAwaitingReconciliation) {
    return "WARM";
  }
  return "COLD";
}

export function resolveFootballCadenceMinutes(mode: FootballSchedulerMode, bucket: FootballCompetitionBucket): number {
  if (mode === "fixtures") {
    if (bucket === "HOT") return 5;
    if (bucket === "WARM") return 10;
    return 60;
  }

  if (mode === "fixtures_hot_pulse") {
    if (bucket === "HOT") return 3;
    return Number.POSITIVE_INFINITY;
  }

  if (mode === "results") {
    if (bucket === "COLD") return 60;
    return 30;
  }

  if (mode === "results_reconcile") {
    return 0;
  }

  if (bucket === "HOT") {
    return 360;
  }
  return 720;
}

function isDue(lastPolledAt: Date | null | undefined, cadenceMinutes: number, now: Date) {
  if (!Number.isFinite(cadenceMinutes)) {
    return false;
  }
  if (cadenceMinutes <= 0) {
    return true;
  }
  if (!lastPolledAt) {
    return true;
  }
  const elapsedMs = now.getTime() - lastPolledAt.getTime();
  return elapsedMs >= cadenceMinutes * 60 * 1000;
}

export function deriveFootballRequestBudget(input: FootballBudgetInput): FootballBudgetOutput {
  const hard = Math.max(1, Math.floor(input.hardLimitPerMinute));
  const reserve = Math.max(0, Math.min(hard - 1, Math.floor(input.reservePerMinute)));
  const target = Math.max(1, Math.min(hard, Math.floor(input.plannedTargetPerMinute)));
  let planned = Math.min(target, Math.max(0, hard - reserve));

  if (typeof input.remainingHeader === "number" && Number.isFinite(input.remainingHeader)) {
    const headroom = Math.max(0, Math.floor(input.remainingHeader) - reserve);
    planned = Math.min(planned, headroom);
  }

  if (input.hadRecent429) {
    planned = Math.min(planned, 4);
  }

  return {
    hardLimitPerMinute: hard,
    reserveCalls: reserve,
    plannedCalls: Math.max(0, planned)
  };
}

export function selectFootballCompetitionsForRun(
  input: FootballCompetitionSelectionInput
): FootballCompetitionSelectionOutput {
  const uniqueCodes = Array.from(
    new Set(
      input.competitionCodes
        .map((code) => code.trim().toUpperCase())
        .filter((code) => code.length > 0)
    )
  );

  type Entry = {
    code: string;
    bucket: FootballCompetitionBucket;
    cadenceMinutes: number;
    due: boolean;
    lastPolledAt: Date | null;
  };

  const entries: Entry[] = uniqueCodes.map((code) => {
    const signals = input.signalsByCode[code] ?? {
      hasLive: false,
      hasKickoffInNext6Hours: false,
      hasKickoffIn6To24Hours: false,
      hasRecentFinishedAwaitingReconciliation: false
    };
    const bucket = classifyFootballCompetitionBucket(signals);
    const cadenceMinutes = resolveFootballCadenceMinutes(input.mode, bucket);
    const lastPolledAt = input.lastPolledAtByCode[code] ?? null;
    return {
      code,
      bucket,
      cadenceMinutes,
      due: isDue(lastPolledAt, cadenceMinutes, input.now),
      lastPolledAt
    };
  });

  const eligibleEntries =
    input.mode === "fixtures_hot_pulse"
      ? entries.filter((entry) => entry.bucket === "HOT")
      : entries;

  const coldStarvationMinutes =
    input.mode === "fixtures"
      ? 240
      : input.mode === "results"
        ? 360
        : input.mode === "standings"
          ? 24 * 60
          : Number.POSITIVE_INFINITY;
  const isStarvedCold = (entry: Entry) => {
    if (entry.bucket !== "COLD" || !Number.isFinite(coldStarvationMinutes)) {
      return false;
    }
    if (!entry.lastPolledAt) {
      return false;
    }
    return input.now.getTime() - entry.lastPolledAt.getTime() >= coldStarvationMinutes * 60 * 1000;
  };

  eligibleEntries.sort((left, right) => {
    const leftStarved = isStarvedCold(left);
    const rightStarved = isStarvedCold(right);
    if (leftStarved !== rightStarved) {
      return leftStarved ? -1 : 1;
    }
    const bucketOrder = bucketPriority(left.bucket) - bucketPriority(right.bucket);
    if (bucketOrder !== 0) {
      return bucketOrder;
    }
    if (left.due !== right.due) {
      return left.due ? -1 : 1;
    }
    const leftPolled = left.lastPolledAt?.getTime() ?? 0;
    const rightPolled = right.lastPolledAt?.getTime() ?? 0;
    if (leftPolled !== rightPolled) {
      return leftPolled - rightPolled;
    }
    return left.code.localeCompare(right.code);
  });

  const dueEntries = eligibleEntries.filter((entry) => entry.due);
  const fallbackEntries = eligibleEntries.filter((entry) => !entry.due);
  const prioritized = [...dueEntries, ...fallbackEntries];

  const baseCap = Math.max(1, Math.floor(input.maxCallsCap));
  const plannedCap = Math.max(0, Math.floor(input.plannedCalls));
  let dynamicCap = Math.min(baseCap, plannedCap);

  if (input.mode === "standings" && input.allowFullCycleWhenSafe) {
    dynamicCap = Math.min(baseCap, eligibleEntries.length);
  }

  const forceIncludeAtLeastOne = input.forceIncludeAtLeastOne ?? true;
  if (dynamicCap === 0 && forceIncludeAtLeastOne && prioritized.length > 0) {
    dynamicCap = 1;
  }

  const selectedCompetitionCodes = prioritized.slice(0, dynamicCap).map((entry) => entry.code);
  const selectedSet = new Set(selectedCompetitionCodes);
  const deferredCompetitionCodes = prioritized
    .filter((entry) => !selectedSet.has(entry.code))
    .map((entry) => entry.code);

  const bucketByCompetitionCode: Record<string, FootballCompetitionBucket> = {};
  const dueByCompetitionCode: Record<string, boolean> = {};
  const cadenceByCompetitionCodeMinutes: Record<string, number> = {};
  for (const entry of entries) {
    bucketByCompetitionCode[entry.code] = entry.bucket;
    dueByCompetitionCode[entry.code] = entry.due;
    cadenceByCompetitionCodeMinutes[entry.code] = entry.cadenceMinutes;
  }

  const bucketSizes = {
    hot: entries.filter((entry) => entry.bucket === "HOT").length,
    warm: entries.filter((entry) => entry.bucket === "WARM").length,
    cold: entries.filter((entry) => entry.bucket === "COLD").length
  };

  const selectedCounts = {
    hot: selectedCompetitionCodes.filter((code) => bucketByCompetitionCode[code] === "HOT").length,
    warm: selectedCompetitionCodes.filter((code) => bucketByCompetitionCode[code] === "WARM").length,
    cold: selectedCompetitionCodes.filter((code) => bucketByCompetitionCode[code] === "COLD").length
  };

  return {
    selectedCompetitionCodes,
    deferredCompetitionCodes,
    bucketByCompetitionCode,
    dueByCompetitionCode,
    cadenceByCompetitionCodeMinutes,
    bucketSizes,
    selectedCounts
  };
}
