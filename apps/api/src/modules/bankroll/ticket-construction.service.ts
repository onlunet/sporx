import { Injectable } from "@nestjs/common";
import { Prisma, StakeDecisionStatus, TicketDecisionStatus } from "@prisma/client";
import { TicketConstructionResult } from "./bankroll.types";
import { round } from "./bankroll-market-family.util";

export type TicketConstructionInput = {
  bankrollAccountId: string;
  stakeRecommendationId: string;
  stakingPolicyVersionId: string | null;
  profileKey: "FLAT_UNIT" | "FRACTIONAL_KELLY" | "CAPPED_FRACTIONAL_KELLY" | "RISK_BUDGETED";
  decisionStatus: StakeDecisionStatus;
  finalStake: number;
  candidate: {
    sportCode: string;
    matchId: string;
    market: string;
    line: number | null;
    lineKey: string;
    horizon: string;
    selection: string;
    publishedPredictionId: string;
    calibratedProbability: number;
    fairOdds: number | null;
    offeredOdds: number | null;
    edge: number | null;
    confidence: number;
    publishScore: number;
  };
  reasons: string[];
};

@Injectable()
export class TicketConstructionService {
  buildDedupKey(input: TicketConstructionInput) {
    return `${input.stakeRecommendationId}:SINGLE`;
  }

  evaluate(input: TicketConstructionInput): TicketConstructionResult {
    if (input.finalStake <= 0 || input.decisionStatus === StakeDecisionStatus.NO_STAKE) {
      return {
        status: TicketDecisionStatus.SKIPPED,
        stake: 0,
        effectiveOdds: input.candidate.offeredOdds,
        reasons: [...input.reasons, "NO_STAKE_AFTER_GOVERNANCE"]
      };
    }

    if (input.decisionStatus === StakeDecisionStatus.BLOCKED) {
      return {
        status: TicketDecisionStatus.BLOCKED,
        stake: 0,
        effectiveOdds: input.candidate.offeredOdds,
        reasons: [...input.reasons, "BLOCKED_BY_GOVERNANCE"]
      };
    }

    if (input.decisionStatus === StakeDecisionStatus.CLIPPED) {
      return {
        status: TicketDecisionStatus.CLIPPED,
        stake: input.finalStake,
        effectiveOdds: input.candidate.offeredOdds,
        reasons: [...input.reasons, "CLIPPED_SINGLE_TICKET"]
      };
    }

    return {
      status: TicketDecisionStatus.CREATED,
      stake: input.finalStake,
      effectiveOdds: input.candidate.offeredOdds,
      reasons: input.reasons
    };
  }

  async persist(tx: Prisma.TransactionClient, input: TicketConstructionInput, result: TicketConstructionResult) {
    const dedupKey = this.buildDedupKey(input);

    const ticketCandidate = await tx.ticketCandidate.upsert({
      where: { dedupKey },
      update: {
        bankrollAccountId: input.bankrollAccountId,
        stakeRecommendationId: input.stakeRecommendationId,
        stakingPolicyVersionId: input.stakingPolicyVersionId,
        ticketType: "SINGLE",
        totalStake: round(result.stake, 6),
        effectiveOdds: result.effectiveOdds,
        decisionStatus: result.status,
        reasonsJson: result.reasons as Prisma.InputJsonValue
      },
      create: {
        bankrollAccountId: input.bankrollAccountId,
        stakeRecommendationId: input.stakeRecommendationId,
        stakingPolicyVersionId: input.stakingPolicyVersionId,
        ticketType: "SINGLE",
        totalStake: round(result.stake, 6),
        effectiveOdds: result.effectiveOdds,
        decisionStatus: result.status,
        reasonsJson: result.reasons as Prisma.InputJsonValue,
        dedupKey
      }
    });

    const ticketDecision = await tx.ticketDecision.upsert({
      where: { ticketCandidateId: ticketCandidate.id },
      update: {
        bankrollAccountId: input.bankrollAccountId,
        stakingPolicyVersionId: input.stakingPolicyVersionId,
        profileKey: input.profileKey,
        totalStake: round(result.stake, 6),
        effectiveOdds: result.effectiveOdds,
        decisionStatus: result.status,
        reasonsJson: result.reasons as Prisma.InputJsonValue
      },
      create: {
        bankrollAccountId: input.bankrollAccountId,
        ticketCandidateId: ticketCandidate.id,
        stakingPolicyVersionId: input.stakingPolicyVersionId,
        profileKey: input.profileKey,
        totalStake: round(result.stake, 6),
        effectiveOdds: result.effectiveOdds,
        decisionStatus: result.status,
        reasonsJson: result.reasons as Prisma.InputJsonValue
      }
    });

    await tx.ticketLeg.deleteMany({
      where: {
        ticketDecisionId: ticketDecision.id
      }
    });

    if (result.stake > 0 && result.status !== TicketDecisionStatus.BLOCKED && result.status !== TicketDecisionStatus.SKIPPED) {
      await tx.ticketLeg.create({
        data: {
          ticketDecisionId: ticketDecision.id,
          legOrder: 1,
          sportCode: input.candidate.sportCode,
          matchId: input.candidate.matchId,
          market: input.candidate.market,
          line: input.candidate.line,
          lineKey: input.candidate.lineKey,
          horizon: input.candidate.horizon,
          selection: input.candidate.selection,
          publishedPredictionId: input.candidate.publishedPredictionId,
          calibratedProbability: input.candidate.calibratedProbability,
          fairOdds: input.candidate.fairOdds,
          offeredOdds: input.candidate.offeredOdds,
          edge: input.candidate.edge,
          confidence: input.candidate.confidence,
          publishScore: input.candidate.publishScore,
          stakeAmount: round(result.stake, 6)
        }
      });
    }

    return {
      ticketCandidate,
      ticketDecision
    };
  }
}
