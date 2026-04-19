import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: vi.fn()
}));
vi.mock("../../src/server/internal-api", () => ({
  fetchInternalApi: vi.fn()
}));

import { cookies } from "next/headers";
import { fetchInternalApi } from "../../src/server/internal-api";
import {
  adminApiGet,
  adminApiPost,
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
  vi.mocked(fetchInternalApi).mockResolvedValue(
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
  });

  it("returns session error when admin cookie is missing", async () => {
    setCookieStore({
      get: () => undefined
    });

    const result = await adminApiGet<unknown[]>("/api/v1/admin/providers");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(fetchInternalApi).not.toHaveBeenCalled();
  });

  it("returns graceful error when upstream API is unreachable", async () => {
    setCookieStore({
      get: (name: string) => (name === "admin_access_token" ? { value: "token" } : undefined)
    });
    vi.mocked(fetchInternalApi).mockRejectedValue(new Error("network down"));

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
    expect(fetchInternalApi).toHaveBeenCalledTimes(1);
    const [path, init, options] = vi.mocked(fetchInternalApi).mock.calls[0] as [string, RequestInit, { allowPublicProxyFallback?: boolean }];
    expect(path).toContain(adminSecurityComplianceEndpoints.dataClassifications);
    expect(init.method).toBe("GET");
    expect(options?.allowPublicProxyFallback).toBe(true);
  });

  it("calls compliance audit and phase4 attestation helpers", async () => {
    setCookieStore({
      get: (name: string) => (name === "admin_access_token" ? { value: "token" } : undefined)
    });
    mockSuccessFetch([]);
    await getComplianceActionAudit();

    mockSuccessFetch([]);
    await getPhase4ReleaseAttestations();

    const calls = vi.mocked(fetchInternalApi).mock.calls.map((entry) => String(entry[0]));
    expect(calls.some((url) => url.includes(adminSecurityComplianceEndpoints.complianceActionAudit))).toBe(true);
    expect(calls.some((url) => url.includes(adminSecurityPhase4Endpoints.releaseAttestations))).toBe(true);
  });

  it("uses public proxy fallback for adminApiPost helper", async () => {
    setCookieStore({
      get: (name: string) => (name === "admin_access_token" ? { value: "token" } : undefined)
    });
    mockSuccessFetch({ queued: true });

    const result = await adminApiPost<{ queued: boolean }>("/api/v1/admin/ingestion/run", { jobType: "syncFixtures" });

    expect(result.ok).toBe(true);
    const [path, init, options] = vi.mocked(fetchInternalApi).mock.calls[0] as [string, RequestInit, { allowPublicProxyFallback?: boolean }];
    expect(path).toBe("/api/v1/admin/ingestion/run");
    expect(init.method).toBe("POST");
    expect(options?.allowPublicProxyFallback).toBe(true);
  });
});
