import { NextRequest, NextResponse } from "next/server";
import { ADMIN_ACCESS_COOKIE_NAME, ADMIN_REFRESH_COOKIE_NAME, INTERNAL_API_URL } from "../../../../src/auth/admin-session";
import { buildExternalUrl } from "../../../../src/server/request-url";

export async function POST(request: NextRequest) {
  const refreshToken = request.cookies.get(ADMIN_REFRESH_COOKIE_NAME)?.value;

  if (refreshToken) {
    try {
      await fetch(`${INTERNAL_API_URL}/api/v1/auth/logout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ refreshToken }),
        cache: "no-store"
      });
    } catch {
      // Logout should still complete in frontend even when backend is temporarily unreachable.
    }
  }

  const url = buildExternalUrl(request, "/admin/login");
  url.searchParams.set("loggedOut", "1");

  const redirect = NextResponse.redirect(url, { status: 303 });
  redirect.cookies.delete(ADMIN_ACCESS_COOKIE_NAME);
  redirect.cookies.delete(ADMIN_REFRESH_COOKIE_NAME);
  return redirect;
}
