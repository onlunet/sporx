import { Injectable } from "@nestjs/common";
import { BankrollLedgerEntryType, Prisma } from "@prisma/client";
import { round } from "./bankroll-market-family.util";

@Injectable()
export class BankrollAccountingService {
  private async appendLedger(
    tx: Prisma.TransactionClient,
    input: {
      accountId: string;
      entryType: BankrollLedgerEntryType;
      amount: number;
      balanceBefore: number;
      balanceAfter: number;
      reservedBefore: number;
      reservedAfter: number;
      realizedPnlBefore: number;
      realizedPnlAfter: number;
      referenceType: string;
      referenceId: string;
      dedupKey: string;
      details?: Prisma.InputJsonValue;
    }
  ) {
    return tx.bankrollLedger.upsert({
      where: { dedupKey: input.dedupKey },
      update: {
        amount: round(input.amount, 6),
        balanceBefore: round(input.balanceBefore, 6),
        balanceAfter: round(input.balanceAfter, 6),
        reservedBefore: round(input.reservedBefore, 6),
        reservedAfter: round(input.reservedAfter, 6),
        realizedPnlBefore: round(input.realizedPnlBefore, 6),
        realizedPnlAfter: round(input.realizedPnlAfter, 6),
        detailsJson: input.details
      },
      create: {
        bankrollAccountId: input.accountId,
        entryType: input.entryType,
        amount: round(input.amount, 6),
        balanceBefore: round(input.balanceBefore, 6),
        balanceAfter: round(input.balanceAfter, 6),
        reservedBefore: round(input.reservedBefore, 6),
        reservedAfter: round(input.reservedAfter, 6),
        realizedPnlBefore: round(input.realizedPnlBefore, 6),
        realizedPnlAfter: round(input.realizedPnlAfter, 6),
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        dedupKey: input.dedupKey,
        detailsJson: input.details
      }
    });
  }

  private async writeSnapshotAndCurve(
    tx: Prisma.TransactionClient,
    input: {
      accountId: string;
      source: string;
      referenceType?: string;
      referenceId?: string;
    }
  ) {
    const account = await tx.bankrollAccount.findUnique({
      where: { id: input.accountId }
    });

    if (!account) {
      throw new Error("bankroll_account_not_found");
    }

    const totalEquity = account.availableBalance + account.reservedBalance;
    const peakPoint = await tx.equityCurvePoint.findFirst({
      where: {
        bankrollAccountId: account.id
      },
      orderBy: {
        totalEquity: "desc"
      },
      select: {
        totalEquity: true
      }
    });

    const peakEquity = peakPoint?.totalEquity ?? account.startingBalance;
    const drawdownPct = peakEquity > 0 ? Math.max(0, (peakEquity - totalEquity) / peakEquity) : 0;

    await tx.bankrollAccountSnapshot.create({
      data: {
        bankrollAccountId: account.id,
        availableBalance: round(account.availableBalance, 6),
        reservedBalance: round(account.reservedBalance, 6),
        totalEquity: round(totalEquity, 6),
        realizedPnl: round(account.realizedPnl, 6),
        unrealizedExposure: round(account.unrealizedExposure, 6),
        drawdownPct: round(drawdownPct, 6),
        source: input.source
      }
    });

    await tx.equityCurvePoint.create({
      data: {
        bankrollAccountId: account.id,
        pointAt: new Date(),
        availableBalance: round(account.availableBalance, 6),
        reservedBalance: round(account.reservedBalance, 6),
        totalEquity: round(totalEquity, 6),
        realizedPnl: round(account.realizedPnl, 6),
        drawdownPct: round(drawdownPct, 6),
        source: input.source,
        referenceType: input.referenceType ?? null,
        referenceId: input.referenceId ?? null
      }
    });

    return {
      account,
      drawdownPct,
      totalEquity
    };
  }

  async reserveForPaperOrder(tx: Prisma.TransactionClient, input: { accountId: string; paperOrderId: string; stake: number }) {
    const account = await tx.bankrollAccount.findUnique({ where: { id: input.accountId } });
    if (!account) {
      throw new Error("bankroll_account_not_found");
    }

    const stake = Math.max(0, round(input.stake, 6));
    if (stake <= 0) {
      return account;
    }

    const availableAfter = Math.max(0, round(account.availableBalance - stake, 6));
    const reservedAfter = round(account.reservedBalance + stake, 6);

    const updated = await tx.bankrollAccount.update({
      where: { id: account.id },
      data: {
        availableBalance: availableAfter,
        reservedBalance: reservedAfter,
        unrealizedExposure: reservedAfter
      }
    });

    await this.appendLedger(tx, {
      accountId: account.id,
      entryType: "ORDER_OPEN",
      amount: -stake,
      balanceBefore: account.availableBalance,
      balanceAfter: availableAfter,
      reservedBefore: account.reservedBalance,
      reservedAfter,
      realizedPnlBefore: account.realizedPnl,
      realizedPnlAfter: account.realizedPnl,
      referenceType: "paper_order",
      referenceId: input.paperOrderId,
      dedupKey: `ledger:open:${input.paperOrderId}`,
      details: {
        kind: "reserve_stake"
      }
    });

    await this.writeSnapshotAndCurve(tx, {
      accountId: account.id,
      source: "paper_execution",
      referenceType: "paper_order",
      referenceId: input.paperOrderId
    });

    return updated;
  }

  async settlePaperOrder(
    tx: Prisma.TransactionClient,
    input: { accountId: string; paperOrderId: string; stake: number; payout: number; pnl: number }
  ) {
    const account = await tx.bankrollAccount.findUnique({ where: { id: input.accountId } });
    if (!account) {
      throw new Error("bankroll_account_not_found");
    }

    const stake = Math.max(0, round(input.stake, 6));
    const payout = Math.max(0, round(input.payout, 6));
    const pnl = round(input.pnl, 6);

    const availableAfter = round(account.availableBalance + payout, 6);
    const reservedAfter = Math.max(0, round(account.reservedBalance - stake, 6));
    const realizedAfter = round(account.realizedPnl + pnl, 6);

    const updated = await tx.bankrollAccount.update({
      where: { id: account.id },
      data: {
        availableBalance: availableAfter,
        reservedBalance: reservedAfter,
        realizedPnl: realizedAfter,
        unrealizedExposure: reservedAfter
      }
    });

    await this.appendLedger(tx, {
      accountId: account.id,
      entryType: "ORDER_SETTLE",
      amount: payout,
      balanceBefore: account.availableBalance,
      balanceAfter: availableAfter,
      reservedBefore: account.reservedBalance,
      reservedAfter,
      realizedPnlBefore: account.realizedPnl,
      realizedPnlAfter: realizedAfter,
      referenceType: "paper_order",
      referenceId: input.paperOrderId,
      dedupKey: `ledger:settle:${input.paperOrderId}`,
      details: {
        stake,
        payout,
        pnl
      }
    });

    await this.writeSnapshotAndCurve(tx, {
      accountId: account.id,
      source: "settlement",
      referenceType: "paper_order",
      referenceId: input.paperOrderId
    });

    return updated;
  }

  async recomputeFromLedger(tx: Prisma.TransactionClient, accountId: string) {
    const account = await tx.bankrollAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new Error("bankroll_account_not_found");
    }

    const ledger = await tx.bankrollLedger.findMany({
      where: { bankrollAccountId: accountId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    let available = account.startingBalance;
    let reserved = 0;
    let realized = 0;

    for (const entry of ledger) {
      available = entry.balanceAfter;
      reserved = entry.reservedAfter;
      realized = entry.realizedPnlAfter;
    }

    return tx.bankrollAccount.update({
      where: { id: accountId },
      data: {
        availableBalance: round(available, 6),
        reservedBalance: round(reserved, 6),
        realizedPnl: round(realized, 6),
        unrealizedExposure: round(reserved, 6)
      }
    });
  }
}
