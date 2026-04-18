import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Admin compliance routes", () => {
  it("sidebar contains phase5 compliance links", () => {
    const sidebar = readFileSync(new URL("./admin-sidebar.tsx", import.meta.url), "utf8");

    const routes = [
      "/admin/security/data-classification",
      "/admin/security/retention-policies",
      "/admin/security/deletion-requests",
      "/admin/security/privacy-exports",
      "/admin/security/cleanup-dry-runs",
      "/admin/security/legal-holds",
      "/admin/security/supply-chain-governance",
      "/admin/security/compliance-audit"
    ];

    for (const route of routes) {
      expect(sidebar.includes(route)).toBe(true);
    }
  });
});
