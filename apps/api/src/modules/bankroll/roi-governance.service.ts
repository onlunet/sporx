import { Injectable } from "@nestjs/common";
import { DriftSeverity, Prisma, RoiGovernanceStatus } from "@prisma/client";
import { GovernanceEvaluation } from "./bankroll.types";
import { round } from "./bankroll-market-family.util";

@Injectable()
export class RoiGovernanceService {
  private toRecord(value: Prisma.JsonValue | null | undefined): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private toNumber(value: unknown, fallback: number) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === "string") {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  private async resolveRuleThresholds(tx: Prisma.TransactionClient, accountId: string) {
    const rules = await tx.roiGovernanceRule.findMany({
      where: {
        bankrollAccountId: accountId,
        isActive: true
      }
    });

    let drawdownWarn = 0.15;
    let drawdownBlock = 0.25;
    let ruinWarn = 0.08;
    let ruinBlock = 0.18;

    for (const rule of rules) {
      const config = this.toRecord(rule.configJson);
      if (rule.ruleKey === "max_drawdown") {
        drawdownWarn = this.toNumber(config.warn, drawdownWarn);
        drawdownBlock = this.toNumber(config.block, drawdownBlock);
      }
      if (rule.ruleKey === "risk_of_ruin") {
        ruinWarn = this.toNumber(config.warn, ruinWarn);
        ruinBlock = this.toNumber(config.block, ruinBlock);
      }
    }

    return {
      drawdownWarn,
      drawdownBlock,
      ruinWarn,
      ruinBlock
    };
  }

  async evaluate(tx: Prisma.TransactionClient, accountId: string): Promise<GovernanceEvaluation> {
    const account = await tx.bankrollAccount.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        startingBalance: true,
        availableBalance: true,
        reservedBalance: true,
        status: true
      }
    });

    if (!account) {
      throw new Error("bankroll_account_not_found");
    }

    const curve = await tx.equityCurvePoint.findMany({
      where: { bankrollAccountId: accountId },
      orderBy: [{ pointAt: "asc" }, { id: "asc" }],
      take: 500
    });

    const equitySeries = curve.length > 0 ? curve.map((item) => item.totalEquity) : [account.availableBalance + account.reservedBalance];
    const peak = Math.max(account.startingBalance, ...equitySeries);
    const current = equitySeries[equitySeries.length - 1] ?? account.startingBalance;
    const drawdownPct = peak > 0 ? Math.max(0, (peak - current) / peak) : 0;

    const returns: number[] = [];
    for (let index = 1; index < equitySeries.length; index += 1) {
      const prev = equitySeries[index - 1];
      const next = equitySeries[index];
      if (prev > 0) {
        returns.push((next - prev) / prev);
      }
    }

    const avgReturn = returns.length > 0 ? returns.reduce((sum, value) => sum + value, 0) / returns.length : 0;
    const variance =
      returns.length > 1
        ? returns.reduce((sum, value) => sum + (value - avgReturn) ** 2, 0) / returns.length
        : 0;
    const volatility = Math.sqrt(Math.max(0, variance));
    const riskOfRuinEstimate = Math.min(1, Math.max(0, drawdownPct * 0.65 + volatility * 2.2));

    const thresholds = await this.resolveRuleThresholds(tx, accountId);

    let status: RoiGovernanceStatus = "HEALTHY";
    const reasons: string[] = [];

    if (drawdownPct >= thresholds.drawdownBlock || riskOfRuinEstimate >= thresholds.ruinBlock) {
      status = "BLOCKED";
      reasons.push("GOVERNANCE_BLOCK_THRESHOLD");
    } else if (drawdownPct >= thresholds.drawdownWarn || riskOfRuinEstimate >= thresholds.ruinWarn) {
      status = "THROTTLED";
      reasons.push("GOVERNANCE_THROTTLE_THRESHOLD");
    }

    if (account.availableBalance + account.reservedBalance < Math.max(50, account.startingBalance * 0.2)) {
      status = status === "BLOCKED" ? "BLOCKED" : "WATCH";
      reasons.push("LOW_OPERATING_BANKROLL");
    }

    if (status !== account.status) {
      await tx.bankrollAuditLog.create({
        data: {
          bankrollAccountId: accountId,
          actor: "system",
          action: "ROI_GOVERNANCE_STATUS_UPDATE",
          entityType: "bankroll_account",
          entityId: accountId,
          reason: reasons.join(",") || null,
          beforeJson: {
            status: account.status
          },
          afterJson: {
            status
          },
          metadataJson: {
            drawdownPct: round(drawdownPct, 6),
            riskOfRuinEstimate: round(riskOfRuinEstimate, 6)
          }
        }
      });
    }

    await tx.bankrollAccount.update({
      where: { id: accountId },
      data: {
        status
      }
    });

    if (drawdownPct >= thresholds.drawdownWarn) {
      await tx.drawdownEvent.create({
        data: {
          bankrollAccountId: accountId,
          status,
          peakEquity: peak,
          troughEquity: current,
          drawdownPct: round(drawdownPct, 6),
          reason: "drawdown_threshold",
          detailsJson: {
            thresholds
          }
        }
      });
    }

    if (status === "BLOCKED" || status === "THROTTLED") {
      await tx.riskLimitBreach.create({
        data: {
          bankrollAccountId: accountId,
          severity: status === "BLOCKED" ? DriftSeverity.CRITICAL : DriftSeverity.WARNING,
          scopeType: "OPEN_TOTAL",
          scopeKey: "*",
          behavior: status === "BLOCKED" ? "BLOCK" : "CLIP",
          limitValue: thresholds.drawdownBlock,
          observedValue: round(drawdownPct, 6),
          actionStatus: status === "BLOCKED" ? "BLOCKED" : "CLIPPED",
          reason: reasons.join(",") || null,
          detailsJson: {
            riskOfRuinEstimate: round(riskOfRuinEstimate, 6)
          }
        }
      });
    }

    return {
      status,
      reasons,
      drawdownPct: round(drawdownPct, 6),
      riskOfRuinEstimate: round(riskOfRuinEstimate, 6)
    };
  }
}
