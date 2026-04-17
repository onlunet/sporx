import { Injectable } from "@nestjs/common";
import { StrategyObjective } from "@prisma/client";
import { ObjectiveDefinition, TrialMetricSet, TrialScoreResult } from "./research-lab.types";

@Injectable()
export class ObjectiveFunctionService {
  private metric(metrics: TrialMetricSet, key: string) {
    const value = (metrics as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private computePrimary(metrics: TrialMetricSet, objective: StrategyObjective): number {
    if (objective === StrategyObjective.LOG_GROWTH) {
      return this.metric(metrics, "roi") - this.metric(metrics, "maxDrawdown") * 0.35;
    }
    if (objective === StrategyObjective.ROI) {
      return this.metric(metrics, "roi");
    }
    if (objective === StrategyObjective.YIELD) {
      return this.metric(metrics, "yield");
    }
    if (objective === StrategyObjective.MIN_MAX_DRAWDOWN) {
      return -this.metric(metrics, "maxDrawdown");
    }
    if (objective === StrategyObjective.SHARPE) {
      const denom = Math.max(0.0001, this.metric(metrics, "maxDrawdown"));
      return this.metric(metrics, "roi") / denom;
    }
    if (objective === StrategyObjective.CALIBRATION_QUALITY) {
      return -(this.metric(metrics, "logLoss") * 0.6 + this.metric(metrics, "brierScore") * 0.4);
    }
    if (objective === StrategyObjective.RISK_OF_RUIN) {
      return -this.metric(metrics, "riskOfRuin");
    }
    return 0;
  }

  score(metrics: TrialMetricSet, definition: ObjectiveDefinition): TrialScoreResult {
    const constraintFailures: string[] = [];
    for (const constraint of definition.constraints ?? []) {
      const value = this.metric(metrics, constraint.metric);
      if (constraint.op === "gte" && value < constraint.value) {
        constraintFailures.push(`${constraint.metric}_lt_${constraint.value}`);
      }
      if (constraint.op === "lte" && value > constraint.value) {
        constraintFailures.push(`${constraint.metric}_gt_${constraint.value}`);
      }
    }

    const primaryScore = this.computePrimary(metrics, definition.primary);
    const weights = definition.weights ?? {};
    const secondaryScore = (definition.secondary ?? []).reduce((sum, metricKey) => {
      const weight = Number.isFinite(weights[metricKey]) ? Number(weights[metricKey]) : 0;
      return sum + this.metric(metrics, metricKey) * weight;
    }, 0);

    return {
      score: Number((primaryScore + secondaryScore).toFixed(8)),
      passedConstraints: constraintFailures.length === 0,
      constraintFailures
    };
  }
}
