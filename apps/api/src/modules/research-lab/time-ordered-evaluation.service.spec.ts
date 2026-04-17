import { TimeOrderedEvaluationService } from "./time-ordered-evaluation.service";

describe("TimeOrderedEvaluationService", () => {
  it("builds strictly ordered rolling windows", () => {
    const service = new TimeOrderedEvaluationService();
    const windows = service.buildWindows({
      mode: "ROLLING",
      rangeStart: new Date("2025-01-01T00:00:00.000Z"),
      rangeEnd: new Date("2025-04-01T00:00:00.000Z"),
      trainDays: 30,
      validationDays: 10,
      testDays: 10,
      stepDays: 10
    });

    expect(windows.length).toBeGreaterThan(0);
    for (const window of windows) {
      expect(window.trainStart.getTime()).toBeLessThan(window.trainEnd.getTime());
      expect(window.trainEnd.getTime()).toBeLessThanOrEqual(window.validationStart.getTime());
      expect(window.validationEnd.getTime()).toBeLessThanOrEqual(window.testStart.getTime());
      expect(window.testStart.getTime()).toBeLessThan(window.testEnd.getTime());
    }
  });

  it("detects leakage when rows are newer than cutoff", () => {
    const service = new TimeOrderedEvaluationService();
    const cutoff = new Date("2026-04-01T00:00:00.000Z");
    const violations = service.findLeakageViolations({
      rows: [
        { source_updated_at: "2026-03-31T10:00:00.000Z" },
        { source_updated_at: "2026-04-01T00:00:00.000Z" },
        { source_updated_at: "2026-04-02T00:00:00.000Z" }
      ],
      cutoffAt: cutoff,
      timestampField: "source_updated_at"
    });

    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe("source_updated_at");
  });

  it("same window produces same hash deterministically", () => {
    const service = new TimeOrderedEvaluationService();
    const window = service.buildWindows({
      mode: "FIXED",
      rangeStart: new Date("2025-01-01T00:00:00.000Z"),
      rangeEnd: new Date("2025-03-01T00:00:00.000Z"),
      trainDays: 30,
      validationDays: 10,
      testDays: 10
    })[0];

    const first = service.hashWindow(window);
    const second = service.hashWindow(window);
    expect(first).toBe(second);
  });
});
