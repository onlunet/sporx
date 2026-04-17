import { Injectable } from "@nestjs/common";
import { PolicyPromotionDecisionStatus, Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { PolicyCandidateEvaluation, PolicyGateDecision } from "./research-lab.types";

type EvaluateAndPersistInput = {
  requestId: string;
  candidateId: string;
  evaluation: PolicyCandidateEvaluation;
  actor?: string;
  allowCanary?: boolean;
  force?: "APPROVE" | "REJECT" | null;
};

@Injectable()
export class PolicyPromotionGateService {
  constructor(private readonly prisma: PrismaService) {}

  evaluate(input: PolicyCandidateEvaluation, allowCanary = false): PolicyGateDecision {
    const reasons: string[] = [];
    if (input.sampleSize < input.minimumSampleSize) {
      reasons.push("insufficient_sample_size");
      return {
        status: PolicyPromotionDecisionStatus.REQUIRE_MORE_EVIDENCE,
        reasons,
        approved: false
      };
    }
    if (input.robustnessScore < input.minimumRobustnessScore) {
      reasons.push("robustness_below_threshold");
    }
    if (input.hasOverfitFlag) {
      reasons.push("overfit_flag_detected");
    }
    if (input.hasSegmentFailure) {
      reasons.push("segment_sanity_failed");
    }
    if (!input.auditComplete) {
      reasons.push("audit_incomplete");
    }

    if (reasons.length > 0) {
      return {
        status: PolicyPromotionDecisionStatus.REJECT,
        reasons,
        approved: false
      };
    }

    return {
      status: allowCanary ? PolicyPromotionDecisionStatus.APPROVE_CANARY : PolicyPromotionDecisionStatus.APPROVE_SHADOW,
      reasons: ["gate_passed"],
      approved: true
    };
  }

  async evaluateAndPersist(input: EvaluateAndPersistInput) {
    const baseDecision = this.evaluate(input.evaluation, Boolean(input.allowCanary));
    const decision = this.applyForce(baseDecision, input.force ?? null);

    const persisted = await this.prisma.$transaction(async (tx) => {
      const row = await tx.policyPromotionDecision.upsert({
        where: { policyPromotionRequestId: input.requestId },
        update: {
          policyCandidateId: input.candidateId,
          decisionStatus: decision.status,
          decisionReasonsJson: {
            reasons: decision.reasons,
            evaluation: input.evaluation
          } as Prisma.InputJsonValue,
          actor: input.actor ?? "system",
          effectiveAt: decision.approved ? new Date() : null
        },
        create: {
          policyPromotionRequestId: input.requestId,
          policyCandidateId: input.candidateId,
          decisionStatus: decision.status,
          decisionReasonsJson: {
            reasons: decision.reasons,
            evaluation: input.evaluation
          } as Prisma.InputJsonValue,
          actor: input.actor ?? "system",
          effectiveAt: decision.approved ? new Date() : null
        }
      });

      await tx.policyPromotionRequest.update({
        where: { id: input.requestId },
        data: {
          status: decision.status,
          decidedAt: new Date()
        }
      });

      return row;
    });

    return {
      decision,
      persisted
    };
  }

  private applyForce(baseDecision: PolicyGateDecision, force: "APPROVE" | "REJECT" | null): PolicyGateDecision {
    if (force === "APPROVE") {
      return {
        status: PolicyPromotionDecisionStatus.FORCE_APPROVE,
        reasons: ["manual_force_approve", ...baseDecision.reasons],
        approved: true
      };
    }
    if (force === "REJECT") {
      return {
        status: PolicyPromotionDecisionStatus.FORCE_REJECT,
        reasons: ["manual_force_reject", ...baseDecision.reasons],
        approved: false
      };
    }
    return baseDecision;
  }
}
