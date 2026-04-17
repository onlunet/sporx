import { Injectable } from "@nestjs/common";
import { Prisma, PrismaClient } from "@prisma/client";
import { TrialPruningDecision, TrialPruningInput } from "./research-lab.types";

type PrismaTx = Prisma.TransactionClient | PrismaClient;

@Injectable()
export class TrialPruningService {
  decide(input: TrialPruningInput): TrialPruningDecision {
    if (input.sampleSize < input.config.minSampleForDecision) {
      return { pruned: false, reason: null };
    }

    if (input.drawdown > input.config.maxDrawdown) {
      return { pruned: true, reason: "drawdown_breach" };
    }

    if (input.riskOfRuin > input.config.maxRiskOfRuin) {
      return { pruned: true, reason: "risk_of_ruin_breach" };
    }

    if (input.roi < input.config.minRoiFloor) {
      return { pruned: true, reason: "roi_floor_breach" };
    }

    if (input.logLoss > input.config.maxLogLoss) {
      return { pruned: true, reason: "calibration_collapse" };
    }

    return { pruned: false, reason: null };
  }

  async persistDecision(
    tx: PrismaTx,
    input: {
      trialId: string;
      decision: TrialPruningDecision;
      metrics?: Record<string, unknown>;
    }
  ) {
    return tx.tuningTrial.update({
      where: { id: input.trialId },
      data: {
        pruned: input.decision.pruned,
        pruneReason: input.decision.reason,
        status: input.decision.pruned ? "pruned" : undefined,
        metricsJson: input.metrics as Prisma.InputJsonValue | undefined,
        completedAt: input.decision.pruned ? new Date() : undefined
      }
    });
  }
}
