import { NextRequest, NextResponse } from "next/server";
import { INTERNAL_API_URL } from "../../../../../../src/auth/admin-session";
import { buildExternalUrl } from "../../../../../../src/server/request-url";
import { applySessionRefreshCookies, clearSessionCookies, resolveAdminSession } from "../../../_lib/session";

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

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const action = String(formData.get("action") ?? "").trim();
  const teamIdsAll = formData
    .getAll("teamIds")
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
  const teamIds = teamIdsAll.length > 0 ? teamIdsAll.join(",") : String(formData.get("teamIds") ?? "").trim();
  const leftTeamId = String(formData.get("leftTeamId") ?? "").trim();
  const rightTeamId = String(formData.get("rightTeamId") ?? "").trim();
  const nextPath = safeNextPath(request, "/admin/teams/identity");

  if (!action) {
    return redirectWithState(request, nextPath, { error: "action_missing" });
  }

  const session = await resolveAdminSession(request);
  if (!session.ok) {
    const response = redirectWithState(request, "/admin/login", { next: nextPath, error: "invalid_credentials" });
    clearSessionCookies(response);
    return response;
  }

  const apiResponse = await fetch(`${INTERNAL_API_URL}/api/v1/admin/teams/identity/rules/action`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`
    },
    body: JSON.stringify({
      action,
      teamIds,
      leftTeamId,
      rightTeamId
    }),
    cache: "no-store"
  });

  if (!apiResponse.ok) {
    const response = redirectWithState(request, nextPath, { error: "action_failed" });
    applySessionRefreshCookies(response, request, session);
    return response;
  }

  const response = redirectWithState(request, nextPath, { updated: "1" });
  applySessionRefreshCookies(response, request, session);
  return response;
}
