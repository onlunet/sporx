import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Admin team identity route", () => {
  it("sidebar contains team identity link", () => {
    const sidebar = readFileSync(new URL("./admin-sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar.includes("/admin/teams/identity")).toBe(true);
  });

  it("page contains manual action forms", () => {
    const pageSource = readFileSync(new URL("../../app/admin/teams/identity/page.tsx", import.meta.url), "utf8");
    expect(pageSource.includes("merge_group")).toBe(true);
    expect(pageSource.includes("block_pair")).toBe(true);
    expect(pageSource.includes("/api/admin/teams/identity/action")).toBe(true);
  });
});

