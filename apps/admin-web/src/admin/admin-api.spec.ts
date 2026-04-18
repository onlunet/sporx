import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn()
}));

import { cookies } from "next/headers";
import {
  adminApiGet,
  adminSecurityComplianceEndpoints,
  adminSecurityPhase4Endpoints,
  getComplianceActionAudit,
  getComplianceDataClassifications,
  getPhase4ReleaseAttestations
} from "../../app/admin/_lib/admin-api";

type CookieValue = { value: string };
type CookieStore = {
  get: (name: string) => CookieValue | undefined;
};

function setCookieStore(store: CookieStore) {
  vi.mocked(cookies).mockResolvedValue(store as never);
}

function mockSuccessFetch(data: unknown) {
  vi.mocked(global.fetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        success: true,
        data,
        meta: null,
        error: null
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    )
  );
}

describe("adminApiGet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("returns session error when admin cookie is missing", async () => {
    setCookieStore({
      get: () => undefined
    });

    const result = await adminApiGet<unknown[]>("/api/v1/admin/providers");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns graceful error when upstream API is unreachable", async () => {
    setCookieStore({
      get: (name: string) => (name === "admin_access_token" ? { value: "token" } : undefined)
    });
    vi.mocked(global.fetch).mockRejectedValue(new Error("network down"));

    const result = await adminApiGet<unknown[]>("/api/v1/admin/providers");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(result.error).toContain("Admin API");
  });

  it("calls compliance endpoint helpers with expected path", async () => {
    setCookieStore({
      get: (name: string) => (name === "admin_access_token" ? { value: "token" } : undefined)
    });
    mockSuccessFetch([]);

    const result = await getComplianceDataClassifications();

    expect(result.ok).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = vi.mocked(global.fetch).mock.calls[0] as [RequestInfo | URL];
    expect(String(url)).toContain(adminSecurityComplianceEndpoints.dataClassifications);
  });

  it("calls compliance audit and phase4 attestation helpers", async () => {
    setCookieStore({
      get: (name: string) => (name === "admin_access_token" ? { value: "token" } : undefined)
    });
    mockSuccessFetch([]);
    await getComplianceActionAudit();

    mockSuccessFetch([]);
    await getPhase4ReleaseAttestations();

    const calls = vi.mocked(global.fetch).mock.calls.map((entry) => String(entry[0]));
    expect(calls.some((url) => url.includes(adminSecurityComplianceEndpoints.complianceActionAudit))).toBe(true);
    expect(calls.some((url) => url.includes(adminSecurityPhase4Endpoints.releaseAttestations))).toBe(true);
  });
});
