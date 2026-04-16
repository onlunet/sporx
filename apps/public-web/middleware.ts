import { NextRequest, NextResponse } from "next/server";

function isSslipHost(hostname: string) {
  return hostname.endsWith(".sslip.io");
}

export function middleware(request: NextRequest) {
  const forceHttpForSslip = process.env.FORCE_HTTP_SSLIP_REDIRECT === "1";
  if (!forceHttpForSslip) {
    return NextResponse.next();
  }

  const forwardedProto = request.headers.get("x-forwarded-proto") ?? request.nextUrl.protocol.replace(":", "");
  const isHttps = forwardedProto.toLowerCase() === "https";
  const hostname = request.nextUrl.hostname.toLowerCase();

  if (!isHttps || !isSslipHost(hostname)) {
    return NextResponse.next();
  }

  const redirectUrl = request.nextUrl.clone();
  redirectUrl.protocol = "http";
  return NextResponse.redirect(redirectUrl, 307);
}

export const config = {
  matcher: ["/:path*"]
};
