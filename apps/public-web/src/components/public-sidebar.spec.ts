import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("PublicSidebar", () => {
  it("must not contain admin link", () => {
    const source = readFileSync(new URL("./public-sidebar.tsx", import.meta.url), "utf8");
    expect(source.includes("/admin")).toBe(false);
    expect(source.toLowerCase().includes("admin")).toBe(false);
  });

  it("renders exact Turkish information architecture in sidebar", () => {
    const source = readFileSync(new URL("./public-sidebar.tsx", import.meta.url), "utf8");

    const requiredLabels = [
      "Panel",
      "FUTBOL",
      "Maçlar",
      "Tahminler",
      "Sonuçlar",
      "Lig Performansı",
      "Başarı Oranları",
      "Karşılaştır",
      "Canlı",
      "BASKETBOL",
      "GENEL",
      "Ligler",
      "Takımlar",
      "Rehber",
      "Hesap"
    ];

    for (const label of requiredLabels) {
      expect(source.includes(label)).toBe(true);
    }

    const requiredRoutes = [
      "/panel",
      "/futbol/maclar",
      "/futbol/tahminler",
      "/futbol/sonuclar",
      "/futbol/lig-performansi",
      "/futbol/basari-oranlari",
      "/futbol/karsilastir",
      "/futbol/canli",
      "/basketbol/maclar",
      "/basketbol/tahminler",
      "/basketbol/sonuclar",
      "/basketbol/lig-performansi",
      "/basketbol/karsilastir",
      "/basketbol/canli",
      "/ligler",
      "/takimlar",
      "/rehber",
      "/hesap"
    ];

    for (const route of requiredRoutes) {
      expect(source.includes(route)).toBe(true);
    }
  });
});
