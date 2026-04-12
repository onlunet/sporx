import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_ACCESS_COOKIE_NAME,
  ADMIN_REFRESH_COOKIE_NAME,
  isSecureRequest,
  refreshAdminTokens,
  validateAdminAccessToken
} from "../../../../src/auth/admin-session";

export type AdminSessionState =
  | {
      ok: true;
      accessToken: string;
      refreshed: false;
    }
  | {
      ok: true;
      accessToken: string;
      refreshed: true;
      refreshToken: string;
    }
  | {
      ok: false;
    };

export async function resolveAdminSession(request: NextRequest): Promise<AdminSessionState> {
  const accessToken = request.cookies.get(ADMIN_ACCESS_COOKIE_NAME)?.value;
  const currentAccess = await validateAdminAccessToken(accessToken);
  if (currentAccess.ok && accessToken) {
    return {
      ok: true,
      accessToken,
      refreshed: false
    };
  }

  const refreshToken = request.cookies.get(ADMIN_REFRESH_COOKIE_NAME)?.value;
  const refreshed = await refreshAdminTokens(refreshToken);
  if (!refreshed) {
    return { ok: false };
  }

  return {
    ok: true,
    accessToken: refreshed.accessToken,
    refreshed: true,
    refreshToken: refreshed.refreshToken
  };
}

export function applySessionRefreshCookies(response: NextResponse, request: NextRequest, session: AdminSessionState) {
  if (!session.ok || !session.refreshed) {
    return;
  }

  const secure = isSecureRequest(request.nextUrl.protocol);
  response.cookies.set(ADMIN_ACCESS_COOKIE_NAME, session.accessToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 15
  });
  response.cookies.set(ADMIN_REFRESH_COOKIE_NAME, session.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.delete(ADMIN_ACCESS_COOKIE_NAME);
  response.cookies.delete(ADMIN_REFRESH_COOKIE_NAME);
}
