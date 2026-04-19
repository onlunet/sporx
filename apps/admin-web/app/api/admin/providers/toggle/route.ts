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
  const formData = await request.formData();
  const providerKey = String(formData.get("key") ?? "").trim();
  const shouldEnable = String(formData.get("isActive") ?? "0") === "1";
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

  let apiResponse: Response;
  try {
    apiResponse = await fetchInternalApi(
      `/api/v1/admin/providers/${providerKey}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${session.accessToken}`
        },
        body: JSON.stringify({ isActive: shouldEnable }),
        cache: "no-store"
      },
      {
        allowPublicProxyFallback: true
      }
    );
  } catch {
    const response = redirectWithState(request, nextPath, { error: "provider_update_failed" });
    applySessionRefreshCookies(response, request, session);
    return response;
  }

  if (!apiResponse.ok) {
    const response = redirectWithState(request, nextPath, { error: "provider_update_failed" });
    applySessionRefreshCookies(response, request, session);
    return response;
  }

  const response = redirectWithState(request, nextPath, { updated: "1" });
  applySessionRefreshCookies(response, request, session);
  return response;
}
