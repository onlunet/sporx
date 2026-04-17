import { Injectable } from "@nestjs/common";
import { MatchStatus, PaperOrderStatus, Prisma } from "@prisma/client";
import { SettlementOutcome } from "./bankroll.types";
import { normalizeSelectionToken, round } from "./bankroll-market-family.util";

type ScorePair = {
  home: number;
  away: number;
};

@Injectable()
export class SettlementService {
  private readScore(home: number | null, away: number | null): ScorePair | null {
    if (home === null || away === null) {
      return null;
    }
    return { home, away };
  }

  private evaluateResult(selection: string, score: ScorePair): boolean {
    const normalized = normalizeSelectionToken(selection);
    if (normalized === "home") {
      return score.home > score.away;
    }
    if (normalized === "draw") {
      return score.home === score.away;
    }
    if (normalized === "away") {
      return score.home < score.away;
    }
    return false;
  }

  private evaluateBtts(selection: string, score: ScorePair): boolean {
    const normalized = normalizeSelectionToken(selection);
    const both = score.home > 0 && score.away > 0;
    if (normalized === "yes") {
      return both;
    }
    if (normalized === "no") {
      return !both;
    }
    return false;
  }

  private evaluateTotal(selection: string, line: number | null, score: ScorePair): { won: boolean; push: boolean } {
    const normalized = normalizeSelectionToken(selection);
    const threshold = line ?? 2.5;
    const total = score.home + score.away;
    if (Math.abs(total - threshold) < 1e-9) {
      return { won: false, push: true };
    }
    if (normalized === "over") {
      return { won: total > threshold, push: false };
    }
    if (normalized === "under") {
      return { won: total < threshold, push: false };
    }
    return { won: false, push: false };
  }

  evaluateSingleLeg(
    input: {
      market: string;
      selection: string;
      line: number | null;
      fullTimeScore: ScorePair | null;
      halfTimeScore: ScorePair | null;
      matchStatus: MatchStatus;
    },
    stake: number,
    odds: number | null
  ): SettlementOutcome {
    if (input.matchStatus === MatchStatus.cancelled) {
      return {
        status: PaperOrderStatus.CANCELLED,
        payout: round(stake, 6),
        pnl: 0,
        reason: "match_cancelled"
      };
    }

    const marketToken = input.market.trim().toLowerCase();
    const isFirstHalf = marketToken.includes("firsthalf") || marketToken.includes("iy");
    const score = isFirstHalf ? input.halfTimeScore : input.fullTimeScore;

    if (!score) {
      return {
        status: PaperOrderStatus.OPEN,
        payout: 0,
        pnl: 0,
        reason: "missing_score"
      };
    }

    let won = false;
    let push = false;

    if (marketToken.includes("result") || marketToken.includes("matchresult") || marketToken.includes("ms")) {
      won = this.evaluateResult(input.selection, score);
    } else if (marketToken.includes("btts") || marketToken.includes("bothteam") || marketToken.includes("kg")) {
      won = this.evaluateBtts(input.selection, score);
    } else if (marketToken.includes("overunder") || marketToken.includes("total") || marketToken.includes("altust")) {
      const result = this.evaluateTotal(input.selection, input.line, score);
      won = result.won;
      push = result.push;
    } else {
      return {
        status: PaperOrderStatus.VOID,
        payout: round(stake, 6),
        pnl: 0,
        reason: "unsupported_market"
      };
    }

    if (push) {
      return {
        status: PaperOrderStatus.PUSH,
        payout: round(stake, 6),
        pnl: 0,
        reason: "push"
      };
    }

    if (won) {
      const effectiveOdds = odds && odds > 1 ? odds : 2;
      const payout = round(stake * effectiveOdds, 6);
      return {
        status: PaperOrderStatus.WON,
        payout,
        pnl: round(payout - stake, 6),
        reason: "won"
      };
    }

    return {
      status: PaperOrderStatus.LOST,
      payout: 0,
      pnl: round(-stake, 6),
      reason: "lost"
    };
  }

  async settleOpenOrders(
    tx: Prisma.TransactionClient,
    input: {
      accountId: string;
      limit?: number;
    }
  ) {
    const openOrders = await tx.paperOrder.findMany({
      where: {
        bankrollAccountId: input.accountId,
        status: PaperOrderStatus.OPEN
      },
      include: {
        ticketDecision: {
          include: {
            legs: {
              include: {
                match: {
                  select: {
                    status: true,
                    homeScore: true,
                    awayScore: true,
                    halfTimeHomeScore: true,
                    halfTimeAwayScore: true
                  }
                }
              }
            }
          }
        },
        settlementRecord: true
      },
      orderBy: {
        createdAt: "asc"
      },
      ...(input.limit && input.limit > 0 ? { take: input.limit } : {})
    });

    const settled: Array<{ paperOrderId: string; outcome: SettlementOutcome }> = [];

    for (const order of openOrders) {
      if (order.settlementRecord) {
        continue;
      }
      const leg = order.ticketDecision.legs[0];
      if (!leg) {
        continue;
      }
      const match = leg.match;
      if (match.status !== MatchStatus.finished && match.status !== MatchStatus.cancelled) {
        continue;
      }

      const outcome = this.evaluateSingleLeg(
        {
          market: leg.market,
          selection: leg.selection,
          line: leg.line,
          fullTimeScore: this.readScore(match.homeScore, match.awayScore),
          halfTimeScore: this.readScore(match.halfTimeHomeScore, match.halfTimeAwayScore),
          matchStatus: match.status
        },
        order.stake,
        leg.offeredOdds ?? order.effectiveOdds
      );

      await tx.paperOrder.update({
        where: { id: order.id },
        data: {
          status: outcome.status,
          settledPayout: outcome.payout,
          settledPnl: outcome.pnl,
          settledAt: new Date()
        }
      });

      await tx.settlementRecord.upsert({
        where: { paperOrderId: order.id },
        update: {
          status: outcome.status,
          payout: outcome.payout,
          pnl: outcome.pnl,
          settledAt: new Date(),
          detailsJson: {
            reason: outcome.reason
          }
        },
        create: {
          bankrollAccountId: input.accountId,
          paperOrderId: order.id,
          status: outcome.status,
          payout: outcome.payout,
          pnl: outcome.pnl,
          settledAt: new Date(),
          detailsJson: {
            reason: outcome.reason
          }
        }
      });

      settled.push({
        paperOrderId: order.id,
        outcome
      });
    }

    return settled;
  }
}
