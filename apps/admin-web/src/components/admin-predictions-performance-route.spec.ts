import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("Admin predictions performance route", () => {
  it("sidebar contains predictions performance link", () => {
    const sidebar = readFileSync(new URL("./admin-sidebar.tsx", import.meta.url), "utf8");
    expect(sidebar.includes("/admin/predictions/performance")).toBe(true);
  });

  it("performance page renders expected title and filters", () => {
    const pageSource = readFileSync(
      new URL("../../app/admin/predictions/performance/page.tsx", import.meta.url),
      "utf8"
    );
    expect(pageSource.includes("Prediction Type Performance")).toBe(true);
    expect(pageSource.includes('name="predictionType"')).toBe(true);
    expect(pageSource.includes('name="modelVersion"')).toBe(true);
    expect(pageSource.includes('name="minSampleSize"')).toBe(true);
  });
});

