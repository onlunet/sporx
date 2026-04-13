import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL } from "../../../../../src/auth/admin-session";
import { buildExternalUrl } from "../../../../../src/server/request-url";
import { applySessionRefreshCookies, clearSessionCookies, resolveAdminSession } from "../../_lib/session";

const MANAGED_SETTING_KEYS = [
  "prediction.lowConfidenceThreshold",
  "prediction.infoFlagSuppressionThreshold",
  "risk.lowScoreBias.threshold",
  "risk.lowScoreBias.totalGoalsThreshold",
  "risk.conflict.baseEloGapThreshold",
  "risk.conflict.leagueGoalEnvMultiplier",
  "risk.conflict.volatilityMultiplier",
  "risk.conflict.outcomeEdgeBase",
  "risk.conflict.outcomeEdgeVolatilityMultiplier",
  "risk.conflict.minCalibratedConfidence"
] as const;

type PresetKey = "aggressive" | "balanced" | "conservative";

const PRESET_VALUES: Record<PresetKey, Record<(typeof MANAGED_SETTING_KEYS)[number], number>> = {
  aggressive: {
    "prediction.lowConfidenceThreshold": 0.5,
    "prediction.infoFlagSuppressionThreshold": 0.75,
    "risk.lowScoreBias.threshold": 0.22,
    "risk.lowScoreBias.totalGoalsThreshold": 1.45,
    "risk.conflict.baseEloGapThreshold": 60,
    "risk.conflict.leagueGoalEnvMultiplier": 24,
    "risk.conflict.volatilityMultiplier": 30,
    "risk.conflict.outcomeEdgeBase": 0.14,
    "risk.conflict.outcomeEdgeVolatilityMultiplier": 0.16,
    "risk.conflict.minCalibratedConfidence": 0.62
  },
  balanced: {
    "prediction.lowConfidenceThreshold": 0.54,
    "prediction.infoFlagSuppressionThreshold": 0.7,
    "risk.lowScoreBias.threshold": 0.18,
    "risk.lowScoreBias.totalGoalsThreshold": 1.6,
    "risk.conflict.baseEloGapThreshold": 45,
    "risk.conflict.leagueGoalEnvMultiplier": 20,
    "risk.conflict.volatilityMultiplier": 25,
    "risk.conflict.outcomeEdgeBase": 0.11,
    "risk.conflict.outcomeEdgeVolatilityMultiplier": 0.12,
    "risk.conflict.minCalibratedConfidence": 0.56
  },
  conservative: {
    "prediction.lowConfidenceThreshold": 0.62,
    "prediction.infoFlagSuppressionThreshold": 0.66,
    "risk.lowScoreBias.threshold": 0.14,
    "risk.lowScoreBias.totalGoalsThreshold": 1.75,
    "risk.conflict.baseEloGapThreshold": 34,
    "risk.conflict.leagueGoalEnvMultiplier": 16,
    "risk.conflict.volatilityMultiplier": 18,
    "risk.conflict.outcomeEdgeBase": 0.08,
    "risk.conflict.outcomeEdgeVolatilityMultiplier": 0.08,
    "risk.conflict.minCalibratedConfidence": 0.5
  }
};

function safeNextPath(request: NextRequest, fallback: string) {
  const next = request.nextUrl.searchParams.get("next") ?? fallback;
  if (!next.startsWith("/admin")) {
    return fallback;
  }
  return next;
}

function redirectWithState(request: NextRequest, path: string, params: Record<string, string>) {
  const url = buildExternalUrl(request, path);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

function parseNumericInput(raw: FormDataEntryValue | null) {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw.trim().replace(",", ".");
  if (normalized.length === 0) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

export async function POST(request: NextRequest) {
  const nextPath = safeNextPath(request, "/admin/system/settings");
  const session = await resolveAdminSession(request);
  if (!session.ok) {
    const response = redirectWithState(request, "/admin/login", { next: nextPath, error: "invalid_credentials" });
    clearSessionCookies(response);
    return response;
  }

  const formData = await request.formData();
  const presetRaw = String(formData.get("preset") ?? "").trim().toLowerCase();
  const preset = (["aggressive", "balanced", "conservative"] as const).find((item) => item === presetRaw);
  const updates = [];

  if (preset) {
    const values = PRESET_VALUES[preset];
    for (const key of MANAGED_SETTING_KEYS) {
      updates.push({
        key,
        value: { value: values[key] }
      });
    }
  } else if (presetRaw.length > 0) {
    const response = redirectWithState(request, nextPath, { error: "preset_unknown" });
    applySessionRefreshCookies(response, request, session);
    return response;
  }

  if (!preset) {
    for (const key of MANAGED_SETTING_KEYS) {
      const parsed = parseNumericInput(formData.get(key));
      if (parsed === null) {
        continue;
      }
      updates.push({
        key,
        value: { value: parsed }
      });
    }
  }

  if (updates.length === 0) {
    const response = redirectWithState(request, nextPath, { error: "settings_empty" });
    applySessionRefreshCookies(response, request, session);
    return response;
  }

  const apiResponse = await fetch(`${INTERNAL_API_URL}/api/v1/admin/system/settings`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`
    },
    body: JSON.stringify(updates),
    cache: "no-store"
  });

  if (!apiResponse.ok) {
    const response = redirectWithState(request, nextPath, { error: "settings_update_failed" });
    applySessionRefreshCookies(response, request, session);
    return response;
  }

  const response = redirectWithState(request, nextPath, {
    updated: "1",
    ...(preset ? { preset } : {})
  });
  applySessionRefreshCookies(response, request, session);
  return response;
}
