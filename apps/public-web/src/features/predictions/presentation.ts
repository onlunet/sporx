import { MatchPredictionItem, PredictionType } from "./types";

const MARKET_PREFIX: Record<PredictionType, string> = {
  fullTimeResult: "MS",
  firstHalfResult: "IY",
  halfTimeFullTime: "IY/MS",
  bothTeamsToScore: "KG",
  totalGoalsOverUnder: "MS",
  correctScore: "Skor",
  goalRange: "Gol Aralığı",
  firstHalfGoals: "1Y",
  secondHalfGoals: "2Y"
};

const OVER_UNDER_TYPES = new Set<PredictionType>(["totalGoalsOverUnder", "firstHalfGoals", "secondHalfGoals"]);

const HTFT_LABELS: Record<string, string> = {
  HH: "1/1",
  HD: "1/X",
  HA: "1/2",
  DH: "X/1",
  DD: "X/X",
  DA: "X/2",
  AH: "2/1",
  AD: "2/X",
  AA: "2/2"
};

function normalizeText(value?: string | null) {
  return (value ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function bestKey(probabilities: Record<string, number> | undefined, keys: string[]) {
  if (!probabilities) {
    return null;
  }
  let selected: string | null = null;
  let score = Number.NEGATIVE_INFINITY;
  for (const key of keys) {
    const value = probabilities[key];
    if (typeof value === "number" && Number.isFinite(value) && value > score) {
      selected = key;
      score = value;
    }
  }
  return selected;
}

function parseSelectionLabel(selectionLabel?: string) {
  const normalized = normalizeText(selectionLabel);
  if (!normalized) {
    return null;
  }
  const hasOver = normalized.includes("over") || normalized.includes("ust");
  const hasUnder = normalized.includes("under") || normalized.includes("alt");
  if (hasOver && hasUnder) {
    return null;
  }
  if (hasOver) {
    return "Üst";
  }
  if (hasUnder) {
    return "Alt";
  }

  const hasYes = normalized.includes("kg var") || normalized === "var" || normalized.includes("yes");
  const hasNo = normalized.includes("kg yok") || normalized === "yok" || normalized.includes("no");
  if (hasYes && hasNo) {
    return null;
  }
  if (hasYes) {
    return "Var";
  }
  if (hasNo) {
    return "Yok";
  }
  if (normalized === "1" || normalized.includes("home") || normalized.includes("ev")) {
    return "1";
  }
  if (normalized === "x" || normalized.includes("draw") || normalized.includes("ber")) {
    return "X";
  }
  if (normalized === "2" || normalized.includes("away") || normalized.includes("dep")) {
    return "2";
  }
  if (/^[12x][/\\-][12x]$/.test(normalized)) {
    return normalized.toUpperCase().replace("\\", "/").replace("-", "/");
  }
  if (/^\d+[-:]\d+$/.test(normalized)) {
    return normalized.replace(":", "-");
  }
    return selectionLabel?.trim() ?? null;
}

function resolveOutcome(item: MatchPredictionItem) {
  const parsedSelection = parseSelectionLabel(item.selectionLabel);
  if (parsedSelection) {
    return parsedSelection;
  }

  const probabilities = item.probabilities;
  if (item.predictionType === "bothTeamsToScore") {
    const key = bestKey(probabilities, ["yes", "bttsYes", "no", "bttsNo"]);
    if (key === "yes" || key === "bttsYes") {
      return "Var";
    }
    if (key === "no" || key === "bttsNo") {
      return "Yok";
    }
    return null;
  }

  if (OVER_UNDER_TYPES.has(item.predictionType)) {
    const key = bestKey(probabilities, ["over", "under", "yes", "no"]);
    if (key === "over" || key === "yes") {
      return "Üst";
    }
    if (key === "under" || key === "no") {
      return "Alt";
    }
    return null;
  }

  if (item.predictionType === "fullTimeResult" || item.predictionType === "firstHalfResult") {
    const key = bestKey(probabilities, ["home", "draw", "away"]);
    if (key === "home") {
      return "1";
    }
    if (key === "draw") {
      return "X";
    }
    if (key === "away") {
      return "2";
    }
    return null;
  }

  if (item.predictionType === "halfTimeFullTime") {
    const key = bestKey(probabilities, Object.keys(HTFT_LABELS));
    return key ? HTFT_LABELS[key] : null;
  }

  if (item.predictionType === "correctScore" && item.scorelineDistribution?.length) {
    return item.scorelineDistribution[0]?.label ?? null;
  }

  if (item.predictionType === "goalRange") {
    const key = bestKey(probabilities, Object.keys(probabilities ?? {}));
    return key;
  }

  return null;
}

function formatLine(line?: number) {
  if (line === undefined || !Number.isFinite(line)) {
    return null;
  }
  return line.toFixed(1);
}

export function predictionMarketContextLabel(item?: MatchPredictionItem | null) {
  if (!item) {
    return "Tahmin";
  }
  const prefix = MARKET_PREFIX[item.predictionType];
  const lineText = formatLine(item.line);

  if (item.predictionType === "bothTeamsToScore") {
    return "KG Var/Yok";
  }
  if (OVER_UNDER_TYPES.has(item.predictionType)) {
    return `${prefix}${lineText ? ` ${lineText}` : ""} Alt/Üst`;
  }
  if (item.predictionType === "fullTimeResult") {
    return "MS 1X2";
  }
  if (item.predictionType === "firstHalfResult") {
    return "IY 1X2";
  }
  if (item.predictionType === "halfTimeFullTime") {
    return "IY/MS";
  }
  return prefix;
}

export function predictionSelectionLabel(item?: MatchPredictionItem | null) {
  if (!item) {
    return null;
  }
  const prefix = MARKET_PREFIX[item.predictionType];
  const outcome = resolveOutcome(item);
  const lineText = formatLine(item.line);

  if (item.predictionType === "bothTeamsToScore") {
    return outcome ? `KG ${outcome}` : "KG Var/Yok";
  }
  if (OVER_UNDER_TYPES.has(item.predictionType)) {
    const base = `${prefix}${lineText ? ` ${lineText}` : ""}`;
    return outcome ? `${base} ${outcome}` : `${base} Alt/Üst`;
  }
  if (item.predictionType === "fullTimeResult") {
    return outcome ? `MS ${outcome}` : "MS 1X2";
  }
  if (item.predictionType === "firstHalfResult") {
    return outcome ? `IY ${outcome}` : "IY 1X2";
  }
  if (item.predictionType === "halfTimeFullTime") {
    return outcome ? `IY/MS ${outcome}` : "IY/MS";
  }
  if (item.predictionType === "correctScore") {
    return outcome ? `Skor ${outcome}` : "Skor";
  }
  if (item.predictionType === "goalRange") {
    return outcome ? `Gol Aralığı ${outcome}` : "Gol Aralığı";
  }
  return outcome ? `${prefix} ${outcome}` : prefix;
}
