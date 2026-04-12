import { TimeDecayService } from "./time-decay.service";

describe("TimeDecayService", () => {
  const service = new TimeDecayService();

  it("gives lower weight for older matches", () => {
    const recent = service.weight(1);
    const old = service.weight(20);
    expect(recent).toBeGreaterThan(old);
  });

  it("computes weighted average with recency bias", () => {
    const value = service.weightedAverage([
      { value: 0.4, daysAgo: 20 },
      { value: 0.8, daysAgo: 1 }
    ]);
    expect(value).toBeGreaterThan(0.6);
  });
});

