import { Injectable } from "@nestjs/common";
import { RobustnessCheckResult, RobustnessSummary } from "./research-lab.types";

type WindowMetrics = {
  roi: number;
  yield: number;
  maxDrawdown: number;
  logLoss: number;
  brierScore: number;
  publishRate: number;
  abstainRate: number;
};

type EvaluateInput = {
  rollingWindows: WindowMetrics[];
  seasonWindows: WindowMetrics[];
  leagueWindows: WindowMetrics[];
  marketWindows: WindowMetrics[];
  horizonWindows: WindowMetrics[];
  oddsCoverageDropDelta: number;
  lineupCoverageDropDelta: number;
  eventCoverageDropDelta: number;
  parameterPerturbationDelta: number;
  overfitGap: number;
};

@Injectable()
export class RobustnessCheckService {
  private variance(values: number[]) {
    if (values.length <= 1) {
      return 0;
    }
    const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
    const sq = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / values.length;
    return sq;
  }

  private consistencyScore(rows: WindowMetrics[], metric: keyof WindowMetrics) {
    if (rows.length === 0) {
      return 0;
    }
    const values = rows.map((row) => row[metric]).filter((value) => Number.isFinite(value));
    if (values.length === 0) {
      return 0;
    }
    const v = this.variance(values);
    const score = 1 / (1 + Math.sqrt(v));
    return Math.max(0, Math.min(1, Number(score.toFixed(6))));
  }

  evaluate(input: EvaluateInput): RobustnessSummary {
    const checks: RobustnessCheckResult[] = [];
    const pushCheck = (checkName: string, score: number, minScore: number, details: Record<string, unknown>) => {
      checks.push({
        checkName,
        score,
        passed: score >= minScore,
        details
      });
    };

    pushCheck(
      "rolling_window_consistency",
      this.consistencyScore(input.rollingWindows, "roi"),
      0.58,
      { sample: input.rollingWindows.length }
    );
    pushCheck(
      "season_stability",
      this.consistencyScore(input.seasonWindows, "yield"),
      0.55,
      { sample: input.seasonWindows.length }
    );
    pushCheck(
      "league_transferability",
      this.consistencyScore(input.leagueWindows, "logLoss"),
      0.5,
      { sample: input.leagueWindows.length }
    );
    pushCheck(
      "market_family_stability",
      this.consistencyScore(input.marketWindows, "brierScore"),
      0.5,
      { sample: input.marketWindows.length }
    );
    pushCheck(
      "horizon_stability",
      this.consistencyScore(input.horizonWindows, "publishRate"),
      0.5,
      { sample: input.horizonWindows.length }
    );
    pushCheck(
      "odds_coverage_sensitivity",
      Math.max(0, 1 - Math.abs(input.oddsCoverageDropDelta)),
      0.45,
      { delta: input.oddsCoverageDropDelta }
    );
    pushCheck(
      "lineup_missingness_sensitivity",
      Math.max(0, 1 - Math.abs(input.lineupCoverageDropDelta)),
      0.45,
      { delta: input.lineupCoverageDropDelta }
    );
    pushCheck(
      "event_missingness_sensitivity",
      Math.max(0, 1 - Math.abs(input.eventCoverageDropDelta)),
      0.4,
      { delta: input.eventCoverageDropDelta }
    );
    pushCheck(
      "parameter_perturbation_stability",
      Math.max(0, 1 - Math.abs(input.parameterPerturbationDelta)),
      0.45,
      { delta: input.parameterPerturbationDelta }
    );
    pushCheck(
      "top_trial_overfit_detection",
      Math.max(0, 1 - Math.abs(input.overfitGap)),
      0.5,
      { gap: input.overfitGap }
    );

    const score = checks.length > 0
      ? Number((checks.reduce((sum, check) => sum + check.score, 0) / checks.length).toFixed(6))
      : 0;
    const failed = checks.filter((check) => !check.passed).map((check) => check.checkName);
    const unstable = failed.length > 0 || score < 0.55;
    const reasons = [
      ...(score < 0.55 ? ["robustness_score_below_threshold"] : []),
      ...failed.map((check) => `failed_${check}`)
    ];

    return {
      score,
      unstable,
      flags: failed,
      reasons,
      checks
    };
  }
}
