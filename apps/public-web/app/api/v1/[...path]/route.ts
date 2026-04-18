import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const RESTRICTED_PUBLIC_PROXY_ROOT_SEGMENTS = new Set(["admin", "security", "compliance", "internal"]);

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function buildUpstreamCandidates() {
  const rawCandidates = [
    process.env.INTERNAL_API_URL,
    process.env.API_URL,
    process.env.NEXT_PUBLIC_API_URL,
    "http://localhost:4000"
  ];

  const unique = new Set<string>();
  for (const raw of rawCandidates) {
    if (!raw) {
      continue;
    }
    const normalized = trimTrailingSlash(raw.trim());
    if (normalized.length > 0) {
      if (normalized.startsWith("http://")) {
        unique.add(`https://${normalized.slice("http://".length)}`);
        unique.add(normalized);
        continue;
      }
      if (normalized.startsWith("https://")) {
        unique.add(normalized);
        unique.add(`http://${normalized.slice("https://".length)}`);
        continue;
      }
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function buildTargetUrl(baseUrl: string, incomingPathname: string, search: string) {
  const apiPrefix = "/api/v1";
  if (baseUrl.endsWith(apiPrefix) && incomingPathname.startsWith(apiPrefix)) {
    return `${baseUrl}${incomingPathname.slice(apiPrefix.length)}${search}`;
  }
  return `${baseUrl}${incomingPathname}${search}`;
}

function normalizePathToken(value: string) {
  try {
    return decodeURIComponent(value).trim().toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function resolveRootSegment(pathParts: string[]) {
  for (const rawPart of pathParts) {
    const tokenized = normalizePathToken(rawPart).split("/");
    for (const token of tokenized) {
      if (token.length > 0) {
        return token;
      }
    }
  }

  return "";
}

function isRestrictedPublicBoundaryPath(pathParts: string[]) {
  const rootSegment = resolveRootSegment(pathParts);
  return RESTRICTED_PUBLIC_PROXY_ROOT_SEGMENTS.has(rootSegment);
}

function buildPublicBoundaryDeniedResponse() {
  return NextResponse.json(
    {
      success: false,
      data: null,
      meta: null,
      error: {
        code: "PUBLIC_ROUTE_FORBIDDEN",
        message: "Requested route is not available from public API."
      }
    },
    { status: 403 }
  );
}

async function proxyRequest(request: NextRequest, pathParts: string[]) {
  if (isRestrictedPublicBoundaryPath(pathParts)) {
    return buildPublicBoundaryDeniedResponse();
  }

  const incomingPathname = `/api/v1/${pathParts.join("/")}`;
  const incomingSearch = request.nextUrl.search ?? "";
  const upstreamCandidates = buildUpstreamCandidates();

  const proxyHeaders = new Headers(request.headers);
  proxyHeaders.delete("host");
  proxyHeaders.delete("content-length");
  proxyHeaders.set("x-public-web-request", "1");
  const forwardedProtoHeader = request.headers.get("x-forwarded-proto");
  const effectiveProto =
    forwardedProtoHeader?.split(",")[0]?.trim() || request.nextUrl.protocol.replace(":", "");
  proxyHeaders.set("x-forwarded-proto", effectiveProto);
  if (request.headers.get("host")) {
    proxyHeaders.set("x-forwarded-host", request.headers.get("host") as string);
  }

  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  let lastError: unknown = null;
  let lastUpstreamResponse: { status: number; payload: string; headers: Headers } | null = null;
  for (let index = 0; index < upstreamCandidates.length; index += 1) {
    const baseUrl = upstreamCandidates[index] as string;
    const targetUrl = buildTargetUrl(baseUrl, incomingPathname, incomingSearch);
    try {
      const upstreamResponse = await fetch(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body,
        cache: "no-store",
        redirect: "manual"
      });

      const payload = await upstreamResponse.text();
      const responseHeaders = new Headers();
      const contentType = upstreamResponse.headers.get("content-type");
      if (contentType) {
        responseHeaders.set("content-type", contentType);
      }
      const setCookie = upstreamResponse.headers.get("set-cookie");
      if (setCookie) {
        responseHeaders.set("set-cookie", setCookie);
      }
      responseHeaders.set("cache-control", "no-store");

      const hasNextCandidate = index < upstreamCandidates.length - 1;
      if (upstreamResponse.status >= 500 && hasNextCandidate) {
        // If a candidate upstream is unhealthy/misconfigured, fail over to next base URL.
        lastUpstreamResponse = {
          status: upstreamResponse.status,
          payload,
          headers: responseHeaders
        };
        continue;
      }

      return new NextResponse(payload, {
        status: upstreamResponse.status,
        headers: responseHeaders
      });
    } catch (error) {
      lastError = error;
    }
  }

  if (lastUpstreamResponse) {
    return new NextResponse(lastUpstreamResponse.payload, {
      status: lastUpstreamResponse.status,
      headers: lastUpstreamResponse.headers
    });
  }

  return NextResponse.json(
    {
      success: false,
      data: null,
      meta: null,
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Upstream API ulasilamiyor."
      }
    },
    { status: 502 }
  );
}

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function POST(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}

export async function OPTIONS(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return proxyRequest(request, path);
}
