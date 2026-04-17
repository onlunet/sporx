import { RobustnessCheckService } from "./robustness-check.service";

describe("RobustnessCheckService", () => {
  it("flags unstable candidate when robustness checks fail", () => {
    const service = new RobustnessCheckService();
    const result = service.evaluate({
      rollingWindows: [{ roi: 0.2, yield: 0.15, maxDrawdown: 0.1, logLoss: 0.9, brierScore: 0.3, publishRate: 0.5, abstainRate: 0.5 }],
      seasonWindows: [{ roi: -0.1, yield: -0.08, maxDrawdown: 0.4, logLoss: 1.2, brierScore: 0.42, publishRate: 0.3, abstainRate: 0.7 }],
      leagueWindows: [{ roi: 0.15, yield: 0.1, maxDrawdown: 0.22, logLoss: 1.1, brierScore: 0.35, publishRate: 0.42, abstainRate: 0.58 }],
      marketWindows: [{ roi: 0.12, yield: 0.1, maxDrawdown: 0.2, logLoss: 1, brierScore: 0.32, publishRate: 0.44, abstainRate: 0.56 }],
      horizonWindows: [{ roi: 0.08, yield: 0.04, maxDrawdown: 0.24, logLoss: 0.95, brierScore: 0.3, publishRate: 0.4, abstainRate: 0.6 }],
      oddsCoverageDropDelta: 0.62,
      lineupCoverageDropDelta: 0.55,
      eventCoverageDropDelta: 0.58,
      parameterPerturbationDelta: 0.52,
      overfitGap: 0.64
    });

    expect(result.unstable).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
  });
});
