import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL } from "../../../../../src/auth/admin-session";
import { applySessionRefreshCookies, clearSessionCookies, resolveAdminSession } from "../../_lib/session";

function safeNextPath(request: NextRequest, fallback: string) {
  const next = request.nextUrl.searchParams.get("next") ?? fallback;
  if (!next.startsWith("/admin")) {
    return fallback;
  }
  return next;
}

function redirectWithState(request: NextRequest, path: string, params: Record<string, string>) {
  const url = new URL(path, request.url);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url);
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const providerKey = String(formData.get("key") ?? "").trim();
  const baseUrl = String(formData.get("baseUrl") ?? "").trim();
  const apiKey = String(formData.get("apiKey") ?? "");
  const competitionCode = String(formData.get("competitionCode") ?? "").trim();
  const soccerLeagueId = String(formData.get("soccerLeagueId") ?? "").trim();
  const basketballLeagueId = String(formData.get("basketballLeagueId") ?? "").trim();
  const nextPath = safeNextPath(request, "/admin/providers");

  if (!providerKey) {
    return redirectWithState(request, nextPath, { error: "provider_key_missing" });
  }

  const session = await resolveAdminSession(request);
  if (!session.ok) {
    const response = redirectWithState(request, "/admin/login", { next: nextPath, error: "invalid_credentials" });
    clearSessionCookies(response);
    return response;
  }

  const updateProviderResponse = await fetch(`${INTERNAL_API_URL}/api/v1/admin/providers/${providerKey}`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`
    },
    body: JSON.stringify({ baseUrl }),
    cache: "no-store"
  });

  if (!updateProviderResponse.ok) {
    const response = redirectWithState(request, nextPath, { error: "provider_update_failed" });
    applySessionRefreshCookies(response, request, session);
    return response;
  }

  const configs: Record<string, string> = {
    apiKey,
    competitionCode,
    soccerLeagueId,
    basketballLeagueId
  };

  const updateConfigResponse = await fetch(`${INTERNAL_API_URL}/api/v1/admin/providers/${providerKey}/configs`, {
    method: "PATCH",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`
    },
    body: JSON.stringify({ configs }),
    cache: "no-store"
  });

  if (!updateConfigResponse.ok) {
    const response = redirectWithState(request, nextPath, { error: "provider_config_failed" });
    applySessionRefreshCookies(response, request, session);
    return response;
  }

  const response = redirectWithState(request, nextPath, { updated: "1" });
  applySessionRefreshCookies(response, request, session);
  return response;
}

