import { ConfidenceRefinementService } from "./confidence-refinement.service";

describe("ConfidenceRefinementService", () => {
  afterEach(() => {
    delete process.env.CONFIDENCE_WEIGHT_PROVIDER_DISAGREEMENT;
  });

  it("keeps raw, calibration, and adjusted confidence separate in diagnostics", () => {
    const service = new ConfidenceRefinementService();

    const result = service.refine({
      market: "match_outcome",
      rawConfidence: 0.62,
      calibrationConfidence: 0.59,
      metaModelConfidence: 0.61,
      calibrationSampleSize: 120,
      calibrationEce: 0.04,
      lineupCoverage: 0.8,
      oddsCoverage: 0.9,
      eventCoverage: 0.7,
      freshnessScore: 0.82,
      volatilityScore: 0.05,
      providerDisagreement: 0.03,
      missingStatsRatio: 0.12,
      riskFlags: []
    });

    expect(result.confidence).toBeGreaterThan(0.55);
    expect(result.diagnostics.rawConfidence).toBe(0.62);
    expect(result.diagnostics.calibrationConfidence).toBe(0.59);
    expect(result.diagnostics.adjustedConfidence).toBe(result.confidence);
    expect(result.diagnostics.marketProfile).toBe("primary_outcome");
  });

  it("penalizes derived total-goals markets more under weak coverage and volatility", () => {
    const service = new ConfidenceRefinementService();

    const primary = service.refine({
      market: "match_outcome",
      rawConfidence: 0.68,
      calibrationConfidence: 0.66,
      metaModelConfidence: 0.64,
      calibrationSampleSize: 20,
      calibrationEce: 0.12,
      lineupCoverage: 0.25,
      oddsCoverage: 0.35,
      eventCoverage: 0.2,
      freshnessScore: 0.4,
      volatilityScore: 0.22,
      providerDisagreement: 0.18,
      missingStatsRatio: 0.55,
      riskFlags: [{ code: "HIGH_MISSING_STATS_RATIO", severity: "high" }]
    });

    const totalGoals = service.refine({
      market: "total_goals_over_under",
      rawConfidence: 0.68,
      calibrationConfidence: 0.66,
      metaModelConfidence: 0.64,
      calibrationSampleSize: 20,
      calibrationEce: 0.12,
      lineupCoverage: 0.25,
      oddsCoverage: 0.35,
      eventCoverage: 0.2,
      freshnessScore: 0.4,
      volatilityScore: 0.22,
      providerDisagreement: 0.18,
      missingStatsRatio: 0.55,
      riskFlags: [{ code: "HIGH_MISSING_STATS_RATIO", severity: "high" }]
    });

    expect(totalGoals.confidence).toBeLessThan(primary.confidence);
    expect(totalGoals.diagnostics.derivedMarket).toBe(true);
    expect(totalGoals.diagnostics.components.derivationPenalty).toBeLessThan(0);
  });

  it("allows signal weights to be tuned through environment variables", () => {
    const service = new ConfidenceRefinementService();
    const base = service.refine({
      market: "moneyline",
      rawConfidence: 0.7,
      calibrationConfidence: 0.68,
      metaModelConfidence: 0.68,
      providerDisagreement: 0.3
    });

    process.env.CONFIDENCE_WEIGHT_PROVIDER_DISAGREEMENT = "0.2";
    const tuned = service.refine({
      market: "moneyline",
      rawConfidence: 0.7,
      calibrationConfidence: 0.68,
      metaModelConfidence: 0.68,
      providerDisagreement: 0.3
    });

    expect(tuned.confidence).toBeLessThan(base.confidence);
    expect(tuned.diagnostics.weights.providerDisagreement).toBe(0.2);
  });
});
