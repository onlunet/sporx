import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  ADMIN_ALLOWED_ROLES,
  ADMIN_REFRESH_COOKIE_NAME,
  INTERNAL_API_URL,
  isSecureRequest
} from "../../../../src/auth/admin-session";

function sanitizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/admin") || value.startsWith("/admin/login")) {
    return "/admin/dashboard";
  }
  return value;
}

function buildLoginRedirect(request: NextRequest, nextPath: string, errorCode: string) {
  const url = new URL("/admin/login", request.url);
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

  const response = await fetch(`${INTERNAL_API_URL}/api/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store"
  });

  if (!response.ok) {
    return buildLoginRedirect(request, nextPath, "invalid_credentials");
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

  const destination = new URL(nextPath, request.url);
  const redirect = NextResponse.redirect(destination, { status: 303 });
  const secure = isSecureRequest(request.nextUrl.protocol);

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
