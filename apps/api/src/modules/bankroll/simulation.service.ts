import { Injectable } from "@nestjs/common";
import { BankrollProfileKey, PaperOrderStatus, Prisma, SimulationRunStatus } from "@prisma/client";
import { round } from "./bankroll-market-family.util";

@Injectable()
export class SimulationService {
  private computeMetrics(rows: Array<{ stake: number; settledPnl: number | null; effectiveOdds: number | null; status: PaperOrderStatus }>) {
    const settled = rows.filter((row) => row.status !== PaperOrderStatus.OPEN);
    const turnover = settled.reduce((sum, row) => sum + row.stake, 0);
    const pnl = settled.reduce((sum, row) => sum + (row.settledPnl ?? 0), 0);
    const wins = settled.filter((row) => row.status === PaperOrderStatus.WON || row.status === PaperOrderStatus.HALF_WON).length;
    const losses = settled.filter((row) => row.status === PaperOrderStatus.LOST || row.status === PaperOrderStatus.HALF_LOST).length;
    const pushes = settled.filter((row) => row.status === PaperOrderStatus.PUSH || row.status === PaperOrderStatus.VOID).length;
    const avgOdds =
      settled.length > 0
        ? settled.reduce((sum, row) => sum + (row.effectiveOdds ?? 0), 0) / settled.length
        : 0;

    const roi = turnover > 0 ? pnl / turnover : 0;
    const hitRate = wins + losses > 0 ? wins / (wins + losses) : 0;

    let peak = 0;
    let equity = 0;
    let maxDrawdown = 0;
    let longestLosingStreak = 0;
    let currentLosingStreak = 0;

    for (const row of settled) {
      equity += row.settledPnl ?? 0;
      peak = Math.max(peak, equity);
      const drawdown = peak > 0 ? (peak - equity) / peak : 0;
      maxDrawdown = Math.max(maxDrawdown, drawdown);

      if (row.status === PaperOrderStatus.LOST || row.status === PaperOrderStatus.HALF_LOST) {
        currentLosingStreak += 1;
        longestLosingStreak = Math.max(longestLosingStreak, currentLosingStreak);
      } else if (row.status !== PaperOrderStatus.OPEN) {
        currentLosingStreak = 0;
      }
    }

    return {
      sampleSize: settled.length,
      turnover: round(turnover, 6),
      pnl: round(pnl, 6),
      roi: round(roi, 6),
      yield: round(roi, 6),
      hitRate: round(hitRate, 6),
      avgOdds: round(avgOdds, 6),
      longestLosingStreak,
      maxDrawdown: round(maxDrawdown, 6),
      riskOfRuinEstimate: round(Math.min(1, Math.max(0, maxDrawdown * (1 - hitRate))), 6),
      pushes
    };
  }

  async runHistoricalSimulation(
    tx: Prisma.TransactionClient,
    input: {
      bankrollAccountId: string;
      profileKey: BankrollProfileKey;
      simulationName: string;
      config: Record<string, unknown>;
      randomSeed?: number | null;
      windowStart?: Date | null;
      windowEnd?: Date | null;
    }
  ) {
    const run = await tx.simulationRun.create({
      data: {
        bankrollAccountId: input.bankrollAccountId,
        profileKey: input.profileKey,
        status: SimulationRunStatus.running,
        simulationName: input.simulationName,
        configJson: input.config as Prisma.InputJsonValue,
        randomSeed: input.randomSeed ?? null,
        windowStart: input.windowStart ?? null,
        windowEnd: input.windowEnd ?? null
      }
    });

    const orders = await tx.paperOrder.findMany({
      where: {
        bankrollAccountId: input.bankrollAccountId,
        ...(input.windowStart || input.windowEnd
          ? {
              createdAt: {
                ...(input.windowStart ? { gte: input.windowStart } : {}),
                ...(input.windowEnd ? { lte: input.windowEnd } : {})
              }
            }
          : {})
      },
      select: {
        stake: true,
        settledPnl: true,
        effectiveOdds: true,
        status: true
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    const metrics = this.computeMetrics(orders);

    await tx.simulationScenario.createMany({
      data: [
        {
          simulationRunId: run.id,
          scenarioName: "singles_only",
          configJson: {
            ticketType: "SINGLE"
          },
          metricsJson: metrics
        },
        {
          simulationRunId: run.id,
          scenarioName: "research_multileg_shadow",
          configJson: {
            ticketType: "MULTI_RESEARCH",
            enabled: false
          },
          metricsJson: {
            ...metrics,
            note: "v1 paper flow does not use public multileg"
          }
        }
      ]
    });

    await tx.simulationRun.update({
      where: { id: run.id },
      data: {
        status: SimulationRunStatus.succeeded,
        metricsJson: metrics as Prisma.InputJsonValue,
        completedAt: new Date()
      }
    });

    return {
      runId: run.id,
      metrics
    };
  }
}
