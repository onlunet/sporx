import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("PublicSidebar", () => {
  it("must not contain admin link", () => {
    const source = readFileSync(new URL("./public-sidebar.tsx", import.meta.url), "utf8");
    expect(source.includes("/admin")).toBe(false);
    expect(source.toLowerCase().includes("admin")).toBe(false);
  });
});
