import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  ADMIN_ALLOWED_ROLES,
  ADMIN_REFRESH_COOKIE_NAME,
  validateAdminAccessToken,
} from "../../../../src/auth/admin-session";
import { fetchInternalApi } from "../../../../src/server/internal-api";
import { buildExternalUrl, isSecureExternalRequest } from "../../../../src/server/request-url";

function sanitizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/admin") || value.startsWith("/admin/login")) {
    return "/admin/dashboard";
  }
  return value;
}

function buildLoginRedirect(request: NextRequest, nextPath: string, errorCode: string) {
  const url = buildExternalUrl(request, "/admin/login");
  url.searchParams.set("next", nextPath);
  url.searchParams.set("error", errorCode);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const nextPath = sanitizeNextPath(String(formData.get("next") ?? ""));

  if (!email || !password) {
    return buildLoginRedirect(request, nextPath, "missing_fields");
  }

  let response: Response;
  try {
    response = await fetchInternalApi(
      "/api/v1/auth/login",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, actorType: "ADMIN" }),
        cache: "no-store"
      },
      {
        allowPublicProxyFallback: true,
        fallbackOnStatusCodes: [403, 404]
      }
    );
  } catch {
    return buildLoginRedirect(request, nextPath, "auth_service_unreachable");
  }

  if (!response.ok) {
    if (response.status === 401) {
      return buildLoginRedirect(request, nextPath, "invalid_credentials");
    }
    if (response.status === 403) {
      return buildLoginRedirect(request, nextPath, "unauthorized_role");
    }
    if (response.status >= 500) {
      return buildLoginRedirect(request, nextPath, "auth_service_unavailable");
    }
    return buildLoginRedirect(request, nextPath, "login_failed");
  }

  const payload = (await response.json()) as {
    data?: { accessToken?: string; refreshToken?: string; user?: { role?: string } };
  };

  const accessToken = payload?.data?.accessToken;
  const refreshToken = payload?.data?.refreshToken;
  const role = payload?.data?.user?.role;

  if (!accessToken || !refreshToken || !role || !ADMIN_ALLOWED_ROLES.has(role)) {
    return buildLoginRedirect(request, nextPath, "unauthorized_role");
  }

  const validatedAccess = await validateAdminAccessToken(accessToken);
  if (!validatedAccess.ok) {
    return buildLoginRedirect(request, nextPath, "session_validation_failed");
  }

  const destination = buildExternalUrl(request, nextPath);
  const redirect = NextResponse.redirect(destination, { status: 303 });
  const secure = isSecureExternalRequest(request);

  redirect.cookies.set(ADMIN_ACCESS_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 15
  });
  redirect.cookies.set(ADMIN_REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });

  return redirect;
}
