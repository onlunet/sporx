import { MatchStatus } from "@prisma/client";

type PublicMatchStatusInput = {
  status: MatchStatus;
  matchDateTimeUTC: Date;
  homeScore?: number | null;
  awayScore?: number | null;
  halfTimeHomeScore?: number | null;
  halfTimeAwayScore?: number | null;
};

const FINISHED_FUTURE_TOLERANCE_MS = 10 * 60 * 1000;
const FUTURE_FINISHED_LIVE_WINDOW_MS = 6 * 60 * 60 * 1000;

function hasAnyVisibleScore(input: PublicMatchStatusInput) {
  return (
    typeof input.homeScore === "number" ||
    typeof input.awayScore === "number" ||
    typeof input.halfTimeHomeScore === "number" ||
    typeof input.halfTimeAwayScore === "number"
  );
}

export function normalizePublicMatchStatus(
  input: PublicMatchStatusInput,
  now: Date = new Date()
): MatchStatus {
  if (input.status !== MatchStatus.finished) {
    return input.status;
  }

  const kickoffTime = input.matchDateTimeUTC.getTime();
  if (!Number.isFinite(kickoffTime)) {
    return input.status;
  }

  const deltaMs = kickoffTime - now.getTime();
  if (deltaMs <= FINISHED_FUTURE_TOLERANCE_MS) {
    return input.status;
  }

  if (hasAnyVisibleScore(input) && deltaMs <= FUTURE_FINISHED_LIVE_WINDOW_MS) {
    return MatchStatus.live;
  }

  return MatchStatus.scheduled;
}

export function expandStatusesForPublicFilter(statuses: MatchStatus[]): MatchStatus[] {
  const expanded = new Set(statuses);
  if (statuses.includes(MatchStatus.live) || statuses.includes(MatchStatus.scheduled)) {
    expanded.add(MatchStatus.finished);
  }
  return Array.from(expanded);
}

export function matchesPublicStatusFilter(statuses: MatchStatus[], status: MatchStatus): boolean {
  return statuses.includes(status);
}
