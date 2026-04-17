const MARKET_FAMILY_MAP: Array<{ matcher: RegExp; family: string }> = [
  { matcher: /fulltimeresult|matchresult|moneyline|ms/i, family: "result" },
  { matcher: /firsthalfresult|iy/i, family: "first_half_result" },
  { matcher: /bothtteamstoscor|bothteamstoscor|btts|kg/i, family: "btts" },
  { matcher: /totalgoalsoverunder|overunder|altust|total/i, family: "totals" },
  { matcher: /correctscore|skor/i, family: "correct_score" },
  { matcher: /halftimefulltime|iyms/i, family: "htft" },
  { matcher: /spread|handicap/i, family: "spread" },
  { matcher: /teamtotal/i, family: "team_total" }
];

export function resolveMarketFamily(market: string) {
  const token = market.trim().toLowerCase();
  for (const entry of MARKET_FAMILY_MAP) {
    if (entry.matcher.test(token)) {
      return entry.family;
    }
  }
  return token.replace(/[^a-z0-9]+/g, "_") || "other";
}

export function normalizeLineKey(line: number | null | undefined) {
  if (line === null || line === undefined || !Number.isFinite(line)) {
    return "na";
  }
  return Number(line).toFixed(2);
}

export function toCalendarKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function normalizeSelectionToken(selection: string) {
  const token = selection.trim().toLowerCase();
  if (["1", "h", "home"].includes(token)) {
    return "home";
  }
  if (["x", "draw", "d"].includes(token)) {
    return "draw";
  }
  if (["2", "a", "away"].includes(token)) {
    return "away";
  }
  if (["yes", "y"].includes(token)) {
    return "yes";
  }
  if (["no", "n"].includes(token)) {
    return "no";
  }
  if (["o", "over"].includes(token)) {
    return "over";
  }
  if (["u", "under"].includes(token)) {
    return "under";
  }
  return token;
}

export function round(value: number, digits = 6) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
