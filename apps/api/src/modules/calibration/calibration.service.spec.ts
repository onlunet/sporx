import { CalibrationService } from "./calibration.service";

function row(input: {
  market?: string;
  line?: number | null;
  probability?: number;
  probabilities?: Record<string, number>;
  homeScore?: number | null;
  awayScore?: number | null;
  halfTimeHomeScore?: number | null;
  halfTimeAwayScore?: number | null;
}) {
  return {
    line: input.line ?? null,
    predictionRun: {
      probability: input.probability ?? 0.6,
      explanationJson: {
        probabilities: input.probabilities ?? { home: input.probability ?? 0.6 }
      }
    },
    match: {
      homeScore: input.homeScore ?? 1,
      awayScore: input.awayScore ?? 0,
      halfTimeHomeScore: input.halfTimeHomeScore ?? 1,
      halfTimeAwayScore: input.halfTimeAwayScore ?? 0
    }
  };
}

describe("CalibrationService", () => {
  it("uses only published prediction samples and keeps sample-limited derived markets conservative", async () => {
    const publishedRows = Array.from({ length: 50 }, () =>
      row({
        probabilities: { home: 0.2 },
        homeScore: 2,
        awayScore: 1,
        halfTimeHomeScore: 1,
        halfTimeAwayScore: 0
      })
    );
    const prisma = {
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue(publishedRows)
      }
    } as any;
    const service = new CalibrationService(prisma);

    const result = await service.calibratePrediction({
      market: "first_half_result",
      horizon: "PRE6",
      selection: "home",
      rawProbability: 0.2,
      coverage: { hasOdds: true, hasLineup: true, hasEvent: true, missingStatsRatio: 0.1 },
      freshnessScore: 0.8
    });

    expect(prisma.publishedPrediction.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ market: "first_half_result" }),
        orderBy: { publishedAt: "asc" }
      })
    );
    expect(result.calibratedProbability).toBe(0.2);
    expect(result.calibrationDiagnostics).toEqual(
      expect.objectContaining({
        calibrationSampleSize: 50,
        calibrationBucket: "0.20-0.30",
        calibrationMethod: "sample_limited_shrinkage",
        minSampleThreshold: 80,
        marketProfile: "early_window",
        correctionWeight: 0
      })
    );
    expect(result.riskFlags.map((flag) => flag.code)).toContain("LOW_CALIBRATION_SAMPLE");
  });

  it("calibrates half-time/full-time selections with market-specific labels", async () => {
    const prisma = {
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 140 }, () =>
            row({
              probabilities: { hd: 0.3 },
              homeScore: 1,
              awayScore: 1,
              halfTimeHomeScore: 1,
              halfTimeAwayScore: 0
            })
          )
        )
      }
    } as any;
    const service = new CalibrationService(prisma);

    const result = await service.calibratePrediction({
      market: "half_time_full_time",
      horizon: "PRE6",
      selection: "HD",
      rawProbability: 0.3,
      coverage: { hasOdds: true, hasLineup: true, hasEvent: true, missingStatsRatio: 0.1 },
      freshnessScore: 0.8
    });

    expect(result.calibration.empiricalRate).toBe(1);
    expect(result.calibrationDiagnostics.calibrationMethod).toBe("market_conservative_time_ordered_empirical");
    expect(result.calibrationDiagnostics.marketProfile).toBe("derived_combo");
    expect(result.calibratedProbability).toBeGreaterThan(0.3);
  });

  it("uses sparse exact-score thresholds and diagnostics for correct score", async () => {
    const prisma = {
      publishedPrediction: {
        findMany: jest.fn().mockResolvedValue(
          Array.from({ length: 200 }, () =>
            row({
              probabilities: { "1-0": 0.08 },
              homeScore: 1,
              awayScore: 0
            })
          )
        )
      }
    } as any;
    const service = new CalibrationService(prisma);

    const result = await service.calibratePrediction({
      market: "correct_score",
      horizon: "PRE6",
      selection: "1-0",
      rawProbability: 0.08,
      coverage: { hasOdds: true, hasLineup: true, hasEvent: true, missingStatsRatio: 0.1 },
      freshnessScore: 0.8
    });

    expect(result.calibrationDiagnostics).toEqual(
      expect.objectContaining({
        calibrationBucket: "0.00-0.10",
        calibrationMethod: "market_conservative_time_ordered_empirical",
        minSampleThreshold: 180,
        marketProfile: "sparse_exact_score"
      })
    );
    expect(result.confidenceScore).toBeLessThan(0.7);
  });
});
