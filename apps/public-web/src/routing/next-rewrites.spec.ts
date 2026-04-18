import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("next rewrites", () => {
  it("contains football success rates Turkish rewrite", () => {
    const configPath = new URL("../../next.config.ts", import.meta.url);
    const source = readFileSync(configPath, "utf8");

    expect(source.includes('source: "/futbol/basari-oranlari"')).toBe(true);
    expect(source.includes('destination: "/football/predictions/success-rates"')).toBe(true);
  });
});
