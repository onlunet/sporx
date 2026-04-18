import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshAdminTokens } from "./admin-session";

describe("refreshAdminTokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn() as unknown as typeof fetch;
  });

  it("returns null without calling API when refresh token is missing", async () => {
    const result = await refreshAdminTokens();

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns null when refresh API request throws", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("socket hang up"));

    const result = await refreshAdminTokens("refresh-token");

    expect(result).toBeNull();
  });
});
