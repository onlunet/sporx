import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("AdminSidebar", () => {
  it("contains only /admin routes", () => {
    const source = readFileSync(new URL("./admin-sidebar.tsx", import.meta.url), "utf8");
    const matches = [...source.matchAll(/href: "([^"]+)"/g)].map((item) => item[1]);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every((path) => path.startsWith("/admin"))).toBe(true);
  });
});

