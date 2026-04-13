import { NextRequest } from "next/server";

function firstHeaderValue(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.split(",")[0]?.trim();
  return normalized && normalized.length > 0 ? normalized : null;
}

export function getRequestProtocol(request: NextRequest): "http:" | "https:" {
  const forwardedProto = firstHeaderValue(request.headers.get("x-forwarded-proto"));
  if (forwardedProto === "https") {
    return "https:";
  }
  if (forwardedProto === "http") {
    return "http:";
  }
  return request.nextUrl.protocol === "https:" ? "https:" : "http:";
}

export function isSecureExternalRequest(request: NextRequest): boolean {
  return process.env.NODE_ENV === "production" && getRequestProtocol(request) === "https:";
}

export function getRequestOrigin(request: NextRequest): string {
  const forwardedHost = firstHeaderValue(request.headers.get("x-forwarded-host"));
  const host = forwardedHost ?? firstHeaderValue(request.headers.get("host")) ?? request.nextUrl.host;
  return `${getRequestProtocol(request)}//${host}`;
}

export function buildExternalUrl(request: NextRequest, path: string): URL {
  return new URL(path, getRequestOrigin(request));
}
