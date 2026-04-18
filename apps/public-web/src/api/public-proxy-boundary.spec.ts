import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../../app/api/v1/[...path]/route";

type RouteContext = {
  params: Promise<{
    path: string[];
  }>;
};

function context(path: string[]): RouteContext {
  return {
    params: Promise.resolve({ path })
  };
}

describe("public api proxy boundary", () => {
  const originalFetch = globalThis.fetch;
  const originalInternalApiUrl = process.env.INTERNAL_API_URL;

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    } else {
      Reflect.deleteProperty(globalThis, "fetch");
    }
    process.env.INTERNAL_API_URL = originalInternalApiUrl;
  });

  it.each(["admin", "security", "compliance", "internal"])(
    "blocks restricted %s root routes and keeps public error surface generic",
    async (segment) => {
      const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
      globalThis.fetch = fetchSpy as typeof fetch;
      const request = new NextRequest(`https://public.local/api/v1/${segment}/sensitive`);

      const response = await GET(request, context([segment, "sensitive"]));
      const payload = await response.json();

      expect(response.status).toBe(403);
      expect(payload).toEqual({
        success: false,
        data: null,
        meta: null,
        error: {
          code: "PUBLIC_ROUTE_FORBIDDEN",
          message: "Requested route is not available from public API."
        }
      });
      const responseSurface = JSON.stringify(payload).toLowerCase();
      expect(responseSurface.includes("admin")).toBe(false);
      expect(responseSurface.includes("security")).toBe(false);
      expect(responseSurface.includes("compliance")).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it("blocks encoded restricted root segments", async () => {
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    globalThis.fetch = fetchSpy as typeof fetch;
    const request = new NextRequest("https://public.local/api/v1/admin%2Fsecurity/access");

    const response = await GET(request, context(["admin%2Fsecurity", "access"]));

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards non-restricted routes through upstream proxy", async () => {
    process.env.INTERNAL_API_URL = "http://api.internal:4000";
    const fetchSpy = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    globalThis.fetch = fetchSpy as typeof fetch;
    const request = new NextRequest("https://public.local/api/v1/matches?take=5");

    const response = await GET(request, context(["matches"]));
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toBe(JSON.stringify({ ok: true }));
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const firstCall = fetchSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [targetUrl, init] = firstCall as unknown as [string, RequestInit];
    expect(targetUrl).toContain("/api/v1/matches?take=5");
    const headers = new Headers(init.headers);
    expect(headers.get("x-public-web-request")).toBe("1");
  });
});
