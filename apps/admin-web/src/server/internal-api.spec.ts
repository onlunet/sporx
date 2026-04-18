import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchInternalApi, resetInternalApiCacheForTests } from "./internal-api";

describe("internal-api failover", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    resetInternalApiCacheForTests();
    process.env.INTERNAL_API_URL = "https://bad.internal";
    process.env.API_URL = "https://good.internal";
    process.env.NEXT_PUBLIC_API_URL = "";
    process.env.INTERNAL_API_FALLBACK_URLS = "";
    process.env.PUBLIC_WEB_URL = "https://public.internal";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    resetInternalApiCacheForTests();
  });

  it("fails over when first upstream returns 503", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("no available server", { status: 503 }))
      .mockResolvedValueOnce(new Response("no available server", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 200 }));

    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await fetchInternalApi("/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@sporx.local", password: "x" }),
      headers: { "content-type": "application/json" }
    });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://bad.internal/api/v1/auth/login");
    expect(fetchMock.mock.calls[2]?.[0]).toBe("https://good.internal/api/v1/auth/login");
  });

  it("uses public proxy candidate for auth fallback when enabled", async () => {
    process.env.INTERNAL_API_URL = "";
    process.env.API_URL = "";
    process.env.NEXT_PUBLIC_API_URL = "";

    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    const response = await fetchInternalApi(
      "/api/v1/auth/refresh",
      {
        method: "POST",
        body: JSON.stringify({ refreshToken: "rt" }),
        headers: { "content-type": "application/json" }
      },
      { allowPublicProxyFallback: true }
    );

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://public.internal/api/v1/auth/refresh");
  });
});
