import { Injectable } from "@nestjs/common";
import { ExposureLimit, StakeDecisionStatus } from "@prisma/client";
import { ExposureCheckInput, ExposureCheckResult, ExposureRuleEvaluation } from "./bankroll.types";
import { clamp, round } from "./bankroll-market-family.util";

@Injectable()
export class ExposureCheckService {
  private evaluateRule(limit: ExposureLimit, input: ExposureCheckInput, currentStake: number): ExposureRuleEvaluation {
    const key = limit.scopeKey;
    const fallbackScopeKey = "*";
    const scopeMatches = (candidate: string) => key === fallbackScopeKey || key === candidate;

    let observed = 0;
    let limitAmount = Number.POSITIVE_INFINITY;

    switch (limit.scopeType) {
      case "MATCH": {
        if (!scopeMatches(input.matchId)) {
          return {
            scopeType: limit.scopeType,
            behavior: limit.behavior,
            scopeKey: key,
            allowedStake: currentStake,
            blocked: false,
            breached: false,
            reason: "scope_not_matched"
          };
        }
        observed = input.openExposureByMatch;
        break;
      }
      case "LEAGUE": {
        const leagueKey = input.leagueId ?? "na";
        if (!scopeMatches(leagueKey)) {
          return {
            scopeType: limit.scopeType,
            behavior: limit.behavior,
            scopeKey: key,
            allowedStake: currentStake,
            blocked: false,
            breached: false,
            reason: "scope_not_matched"
          };
        }
        observed = input.openExposureByLeague;
        break;
      }
      case "SPORT": {
        if (!scopeMatches(input.sportCode)) {
          return {
            scopeType: limit.scopeType,
            behavior: limit.behavior,
            scopeKey: key,
            allowedStake: currentStake,
            blocked: false,
            breached: false,
            reason: "scope_not_matched"
          };
        }
        observed = input.openExposureBySport;
        break;
      }
      case "MARKET_FAMILY": {
        if (!scopeMatches(input.marketFamily)) {
          return {
            scopeType: limit.scopeType,
            behavior: limit.behavior,
            scopeKey: key,
            allowedStake: currentStake,
            blocked: false,
            breached: false,
            reason: "scope_not_matched"
          };
        }
        observed = input.openExposureByFamily;
        break;
      }
      case "HORIZON": {
        if (!scopeMatches(input.horizon)) {
          return {
            scopeType: limit.scopeType,
            behavior: limit.behavior,
            scopeKey: key,
            allowedStake: currentStake,
            blocked: false,
            breached: false,
            reason: "scope_not_matched"
          };
        }
        observed = input.openExposureByHorizon;
        break;
      }
      case "CALENDAR_DAY": {
        if (!scopeMatches(input.calendarKey)) {
          return {
            scopeType: limit.scopeType,
            behavior: limit.behavior,
            scopeKey: key,
            allowedStake: currentStake,
            blocked: false,
            breached: false,
            reason: "scope_not_matched"
          };
        }
        observed = input.openExposureBySport;
        break;
      }
      case "ROLLING_7D": {
        observed = input.openExposureBySport;
        break;
      }
      case "OPEN_TOTAL": {
        observed = input.openExposureTotal;
        break;
      }
      case "CONCURRENT_OPEN": {
        const maxConcurrent = limit.maxAmount ?? Number.POSITIVE_INFINITY;
        const wouldBe = input.openTickets + 1;
        const breached = wouldBe > maxConcurrent;
        return {
          scopeType: limit.scopeType,
          behavior: limit.behavior,
          scopeKey: key,
          allowedStake: breached && limit.behavior !== "ALLOW" ? 0 : currentStake,
          blocked: breached && limit.behavior === "BLOCK",
          breached,
          reason: breached
            ? `concurrent_open_limit_exceeded(${wouldBe.toFixed(0)}>${maxConcurrent.toFixed(0)})`
            : "ok"
        };
      }
      default: {
        observed = input.openExposureTotal;
        break;
      }
    }

    if (Number.isFinite(limit.maxAmount ?? Number.NaN)) {
      limitAmount = Math.min(limitAmount, limit.maxAmount as number);
    }
    if (Number.isFinite(limit.maxFraction ?? Number.NaN)) {
      limitAmount = Math.min(limitAmount, (limit.maxFraction as number) * input.bankrollValue);
    }

    if (!Number.isFinite(limitAmount)) {
      return {
        scopeType: limit.scopeType,
        behavior: limit.behavior,
        scopeKey: key,
        allowedStake: currentStake,
        blocked: false,
        breached: false,
        reason: "no_limit"
      };
    }

    const remaining = limitAmount - observed;
    const breached = remaining < currentStake - 1e-9;

    if (!breached) {
      return {
        scopeType: limit.scopeType,
        behavior: limit.behavior,
        scopeKey: key,
        allowedStake: currentStake,
        blocked: false,
        breached: false,
        reason: "ok"
      };
    }

    if (limit.behavior === "ALLOW") {
      return {
        scopeType: limit.scopeType,
        behavior: limit.behavior,
        scopeKey: key,
        allowedStake: currentStake,
        blocked: false,
        breached: true,
        reason: `breach_allowed(remaining=${round(remaining, 4)})`
      };
    }

    if (limit.behavior === "BLOCK") {
      return {
        scopeType: limit.scopeType,
        behavior: limit.behavior,
        scopeKey: key,
        allowedStake: 0,
        blocked: true,
        breached: true,
        reason: `blocked_by_limit(remaining=${round(remaining, 4)})`
      };
    }

    return {
      scopeType: limit.scopeType,
      behavior: limit.behavior,
      scopeKey: key,
      allowedStake: clamp(remaining, 0, currentStake),
      blocked: false,
      breached: true,
      reason: `clipped_by_limit(remaining=${round(remaining, 4)})`
    };
  }

  evaluate(input: ExposureCheckInput, limits: ExposureLimit[]): ExposureCheckResult {
    let currentStake = Math.max(0, input.proposedStake);
    const reasons: string[] = [];
    const evaluations: ExposureRuleEvaluation[] = [];

    for (const limit of limits.filter((item) => item.isActive)) {
      const evaluation = this.evaluateRule(limit, input, currentStake);
      evaluations.push(evaluation);

      if (evaluation.blocked) {
        reasons.push(`BLOCKED_${limit.scopeType}_${evaluation.reason}`);
        return {
          status: StakeDecisionStatus.BLOCKED,
          stakeAfterGovernance: 0,
          reasons,
          evaluations
        };
      }

      if (evaluation.allowedStake < currentStake - 1e-9) {
        reasons.push(`CLIPPED_${limit.scopeType}_${evaluation.reason}`);
        currentStake = evaluation.allowedStake;
      }
    }

    if (currentStake <= 0) {
      reasons.push("EXPOSURE_ZERO_STAKE");
      return {
        status: StakeDecisionStatus.BLOCKED,
        stakeAfterGovernance: 0,
        reasons,
        evaluations
      };
    }

    return {
      status: currentStake < input.proposedStake - 1e-9 ? StakeDecisionStatus.CLIPPED : StakeDecisionStatus.SIZED,
      stakeAfterGovernance: round(currentStake, 6),
      reasons,
      evaluations
    };
  }
}
