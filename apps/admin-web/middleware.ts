import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  ADMIN_REFRESH_COOKIE_NAME,
  refreshAdminTokens,
  validateAdminAccessToken
} from "./src/auth/admin-session";
import { buildExternalUrl, isSecureExternalRequest } from "./src/server/request-url";

const LOGIN_PATH = "/admin/login";
const DASHBOARD_PATH = "/admin/dashboard";

function setSessionCookies(response: NextResponse, accessToken: string, refreshToken: string, secure: boolean) {
  response.cookies.set(ADMIN_ACCESS_COOKIE_NAME, accessToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 15
  });
  response.cookies.set(ADMIN_REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

function clearSessionCookies(response: NextResponse) {
  response.cookies.delete(ADMIN_ACCESS_COOKIE_NAME);
  response.cookies.delete(ADMIN_REFRESH_COOKIE_NAME);
}

function buildSafeAdminTarget(request: NextRequest) {
  const target = request.nextUrl.searchParams.get("next");
  return target && target.startsWith("/admin") ? target : DASHBOARD_PATH;
}

export async function middleware(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/admin")) {
    return NextResponse.next();
  }

  const isLoginPage = request.nextUrl.pathname === LOGIN_PATH;
  const secure = isSecureExternalRequest(request);
  const accessToken = request.cookies.get(ADMIN_ACCESS_COOKIE_NAME)?.value;
  const refreshToken = request.cookies.get(ADMIN_REFRESH_COOKIE_NAME)?.value;
  const auth = await validateAdminAccessToken(accessToken);

  if (auth.ok) {
    if (isLoginPage) {
      return NextResponse.redirect(buildExternalUrl(request, buildSafeAdminTarget(request)));
    }

    const headers = new Headers(request.headers);
    headers.set("x-admin-authenticated", "1");
    headers.set("x-admin-login-page", "0");
    headers.set("x-admin-role", auth.role);

    return NextResponse.next({
      request: {
        headers
      }
    });
  }

  const refreshed = await refreshAdminTokens(refreshToken);
  if (refreshed) {
    const destination = isLoginPage
      ? buildExternalUrl(request, buildSafeAdminTarget(request))
      : buildExternalUrl(request, `${request.nextUrl.pathname}${request.nextUrl.search}`);
    const response = NextResponse.redirect(destination);
    setSessionCookies(response, refreshed.accessToken, refreshed.refreshToken, secure);
    return response;
  }

  if (isLoginPage) {
    const response = NextResponse.next();
    clearSessionCookies(response);
    return response;
  }

  const loginUrl = buildExternalUrl(request, LOGIN_PATH);
  loginUrl.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(loginUrl);
  clearSessionCookies(response);
  return response;
}

export const config = {
  matcher: ["/admin/:path*"]
};
