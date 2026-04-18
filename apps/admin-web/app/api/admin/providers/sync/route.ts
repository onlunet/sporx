import { NextRequest, NextResponse } from "next/server";
import { fetchInternalApi } from "../../../../../src/server/internal-api";
import { buildExternalUrl } from "../../../../../src/server/request-url";
import { applySessionRefreshCookies, clearSessionCookies, resolveAdminSession } from "../../_lib/session";

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
  const nextPath = safeNextPath(request, "/admin/providers");
  const session = await resolveAdminSession(request);

  if (!session.ok) {
    const response = redirectWithState(request, "/admin/login", { next: nextPath, error: "invalid_credentials" });
    clearSessionCookies(response);
    return response;
  }

  const apiResponse = await fetchInternalApi("/api/v1/admin/ingestion/run", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${session.accessToken}`
    },
    body: JSON.stringify({ jobType: "syncFixtures" }),
    cache: "no-store"
  });

  if (!apiResponse.ok) {
    const response = redirectWithState(request, nextPath, { error: "sync_enqueue_failed" });
    applySessionRefreshCookies(response, request, session);
    return response;
  }

  const response = redirectWithState(request, nextPath, { syncQueued: "1" });
  applySessionRefreshCookies(response, request, session);
  return response;
}
