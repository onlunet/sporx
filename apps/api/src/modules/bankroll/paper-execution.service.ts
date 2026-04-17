import { Injectable } from "@nestjs/common";
import { PaperOrderStatus, Prisma, TicketDecisionStatus } from "@prisma/client";
import { round } from "./bankroll-market-family.util";

@Injectable()
export class PaperExecutionService {
  async executeSingleTicket(
    tx: Prisma.TransactionClient,
    input: {
      bankrollAccountId: string;
      ticketDecisionId: string;
      ticketStatus: TicketDecisionStatus;
      stake: number;
      effectiveOdds: number | null;
      dedupKey: string;
      details?: Record<string, unknown>;
    }
  ) {
    if (input.ticketStatus === TicketDecisionStatus.BLOCKED || input.ticketStatus === TicketDecisionStatus.SKIPPED) {
      return null;
    }

    if (input.stake <= 0) {
      return null;
    }

    const effectiveOdds = input.effectiveOdds && Number.isFinite(input.effectiveOdds) && input.effectiveOdds > 1
      ? round(input.effectiveOdds, 6)
      : null;

    const potentialReturn = effectiveOdds ? round(input.stake * effectiveOdds, 6) : null;

    const order = await tx.paperOrder.upsert({
      where: { dedupKey: input.dedupKey },
      update: {
        bankrollAccountId: input.bankrollAccountId,
        ticketDecisionId: input.ticketDecisionId,
        status: PaperOrderStatus.OPEN,
        stake: round(input.stake, 6),
        effectiveOdds,
        potentialReturn,
        detailsJson: input.details as Prisma.InputJsonValue | undefined,
        placedAt: new Date(),
        settledAt: null
      },
      create: {
        bankrollAccountId: input.bankrollAccountId,
        ticketDecisionId: input.ticketDecisionId,
        status: PaperOrderStatus.OPEN,
        stake: round(input.stake, 6),
        effectiveOdds,
        potentialReturn,
        detailsJson: input.details as Prisma.InputJsonValue | undefined,
        dedupKey: input.dedupKey,
        placedAt: new Date()
      }
    });

    await tx.ticketDecision.update({
      where: { id: input.ticketDecisionId },
      data: {
        decisionStatus: TicketDecisionStatus.EXECUTED_PAPER
      }
    });

    return order;
  }
}
