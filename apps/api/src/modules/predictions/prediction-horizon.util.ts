import { MatchStatus } from "@prisma/client";

export const FOOTBALL_PRE_MATCH_HORIZONS = ["PRE72", "PRE24", "PRE6", "LINEUP"] as const;
export const FOOTBALL_LIVE_HORIZONS = [
  "LIVE_0_15",
  "LIVE_16_30",
  "LIVE_31_45",
  "HT",
  "LIVE_46_60",
  "LIVE_61_75",
  "LIVE_76_90"
] as const;
export const FOOTBALL_POST_MATCH_HORIZON = "POST_MATCH" as const;

export const FOOTBALL_PREDICTION_HORIZONS = [
  ...FOOTBALL_PRE_MATCH_HORIZONS,
  ...FOOTBALL_LIVE_HORIZONS
] as const;

export type FootballPredictionHorizon = (typeof FOOTBALL_PREDICTION_HORIZONS)[number];
export type FootballPredictionLifecycleHorizon = FootballPredictionHorizon | typeof FOOTBALL_POST_MATCH_HORIZON;

type ResolvePredictionHorizonInput = {
  status: MatchStatus;
  kickoffAt: Date;
  now?: Date;
  elapsedMinute?: number | null;
  hasLineup?: boolean;
};

function safeElapsedMinute(input: ResolvePredictionHorizonInput) {
  if (typeof input.elapsedMinute === "number" && Number.isFinite(input.elapsedMinute)) {
    return Math.max(0, Math.floor(input.elapsedMinute));
  }
  const now = input.now ?? new Date();
  const fromKickoff = Math.floor((now.getTime() - input.kickoffAt.getTime()) / 60000);
  return Math.max(0, fromKickoff);
}

function resolvePreMatchHorizon(kickoffAt: Date, now: Date, hasLineup: boolean) {
  const hoursToKickoff = (kickoffAt.getTime() - now.getTime()) / (60 * 60 * 1000);
  if (hasLineup || hoursToKickoff <= 1.5) {
    return "LINEUP" as const;
  }
  if (hoursToKickoff <= 6) {
    return "PRE6" as const;
  }
  if (hoursToKickoff <= 24) {
    return "PRE24" as const;
  }
  return "PRE72" as const;
}

function resolveLiveHorizon(elapsedMinute: number) {
  if (elapsedMinute <= 15) {
    return "LIVE_0_15" as const;
  }
  if (elapsedMinute <= 30) {
    return "LIVE_16_30" as const;
  }
  if (elapsedMinute <= 45) {
    return "LIVE_31_45" as const;
  }
  if (elapsedMinute <= 50) {
    return "HT" as const;
  }
  if (elapsedMinute <= 60) {
    return "LIVE_46_60" as const;
  }
  if (elapsedMinute <= 75) {
    return "LIVE_61_75" as const;
  }
  return "LIVE_76_90" as const;
}

export function resolveFootballPredictionHorizon(input: ResolvePredictionHorizonInput): FootballPredictionLifecycleHorizon {
  const now = input.now ?? new Date();
  if (input.status === MatchStatus.finished) {
    return FOOTBALL_POST_MATCH_HORIZON;
  }
  if (input.status === MatchStatus.live) {
    return resolveLiveHorizon(safeElapsedMinute(input));
  }
  return resolvePreMatchHorizon(input.kickoffAt, now, Boolean(input.hasLineup));
}

export function isLivePredictionHorizon(horizon: string) {
  return horizon === "HT" || horizon.toUpperCase().startsWith("LIVE_");
}
