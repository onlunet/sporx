import { Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { BankrollProfileKey } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { AdminRoles } from "../../common/decorators/admin-roles.decorator";
import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";
import { RolesGuard } from "../../common/guards/roles.guard";
import { SimulationService } from "../bankroll/simulation.service";
import { RoiGovernanceService } from "../bankroll/roi-governance.service";

@Controller("admin/bankroll")
@UseGuards(JwtAuthGuard, RolesGuard)
@AdminRoles()
export class AdminBankrollController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly simulationService: SimulationService,
    private readonly roiGovernanceService: RoiGovernanceService
  ) {}

  @Get("summary")
  async summary(@Query("accountId") accountId?: string) {
    const account = accountId
      ? await this.prisma.bankrollAccount.findUnique({ where: { id: accountId } })
      : await this.prisma.bankrollAccount.findFirst({ orderBy: { updatedAt: "desc" } });

    if (!account) {
      return {
        account: null,
        metrics: null
      };
    }

    const [openOrders, settledOrders, breaches, latestSimulation] = await Promise.all([
      this.prisma.paperOrder.count({ where: { bankrollAccountId: account.id, status: "OPEN" } }),
      this.prisma.paperOrder.count({ where: { bankrollAccountId: account.id, NOT: { status: "OPEN" } } }),
      this.prisma.riskLimitBreach.count({
        where: {
          bankrollAccountId: account.id,
          createdAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
        }
      }),
      this.prisma.simulationRun.findFirst({
        where: { bankrollAccountId: account.id },
        orderBy: { createdAt: "desc" }
      })
    ]);

    return {
      account,
      metrics: {
        openOrders,
        settledOrders,
        breachesLast7d: breaches,
        latestSimulation: latestSimulation
          ? {
              id: latestSimulation.id,
              status: latestSimulation.status,
              createdAt: latestSimulation.createdAt,
              metrics: latestSimulation.metricsJson
            }
          : null
      }
    };
  }

  @Get("equity-curve")
  async equityCurve(@Query("accountId") accountId?: string, @Query("take") take = "200") {
    const account = accountId
      ? await this.prisma.bankrollAccount.findUnique({ where: { id: accountId } })
      : await this.prisma.bankrollAccount.findFirst({ orderBy: { updatedAt: "desc" } });
    if (!account) {
      return [];
    }

    const parsedTake = Math.max(10, Math.min(2000, Number(take) || 200));
    return this.prisma.equityCurvePoint.findMany({
      where: { bankrollAccountId: account.id },
      orderBy: [{ pointAt: "desc" }],
      take: parsedTake
    });
  }

  @Get("exposure")
  async exposure(@Query("accountId") accountId?: string, @Query("take") take = "150") {
    const account = accountId
      ? await this.prisma.bankrollAccount.findUnique({ where: { id: accountId } })
      : await this.prisma.bankrollAccount.findFirst({ orderBy: { updatedAt: "desc" } });
    if (!account) {
      return [];
    }

    const parsedTake = Math.max(10, Math.min(1000, Number(take) || 150));
    return this.prisma.exposureSnapshot.findMany({
      where: { bankrollAccountId: account.id },
      orderBy: [{ createdAt: "desc" }],
      take: parsedTake
    });
  }

  @Get("stake-funnel")
  async stakeFunnel(@Query("accountId") accountId?: string) {
    const account = accountId
      ? await this.prisma.bankrollAccount.findUnique({ where: { id: accountId } })
      : await this.prisma.bankrollAccount.findFirst({ orderBy: { updatedAt: "desc" } });
    if (!account) {
      return null;
    }

    const [candidates, recommendations, executed, blocked, clipped] = await Promise.all([
      this.prisma.stakeCandidate.count({ where: { bankrollAccountId: account.id } }),
      this.prisma.stakeRecommendation.count({ where: { bankrollAccountId: account.id } }),
      this.prisma.paperOrder.count({ where: { bankrollAccountId: account.id } }),
      this.prisma.stakeRecommendation.count({ where: { bankrollAccountId: account.id, decisionStatus: "BLOCKED" } }),
      this.prisma.stakeRecommendation.count({ where: { bankrollAccountId: account.id, decisionStatus: "CLIPPED" } })
    ]);

    return {
      candidates,
      recommendations,
      executed,
      blocked,
      clipped,
      passRate: candidates > 0 ? Number((executed / candidates).toFixed(4)) : 0
    };
  }

  @Get("settlements")
  async settlements(@Query("accountId") accountId?: string, @Query("take") take = "200") {
    const account = accountId
      ? await this.prisma.bankrollAccount.findUnique({ where: { id: accountId } })
      : await this.prisma.bankrollAccount.findFirst({ orderBy: { updatedAt: "desc" } });
    if (!account) {
      return [];
    }

    const parsedTake = Math.max(10, Math.min(2000, Number(take) || 200));
    return this.prisma.settlementRecord.findMany({
      where: { bankrollAccountId: account.id },
      orderBy: [{ settledAt: "desc" }],
      take: parsedTake,
      include: {
        paperOrder: true
      }
    });
  }

  @Get("governance")
  async governance(@Query("accountId") accountId?: string) {
    const account = accountId
      ? await this.prisma.bankrollAccount.findUnique({ where: { id: accountId } })
      : await this.prisma.bankrollAccount.findFirst({ orderBy: { updatedAt: "desc" } });
    if (!account) {
      return null;
    }

    const [rules, events, breaches] = await Promise.all([
      this.prisma.roiGovernanceRule.findMany({ where: { bankrollAccountId: account.id, isActive: true } }),
      this.prisma.drawdownEvent.findMany({ where: { bankrollAccountId: account.id }, orderBy: { createdAt: "desc" }, take: 100 }),
      this.prisma.riskLimitBreach.findMany({ where: { bankrollAccountId: account.id }, orderBy: { createdAt: "desc" }, take: 100 })
    ]);

    return {
      accountStatus: account.status,
      rules,
      events,
      breaches
    };
  }

  @Post("simulate")
  async simulate(
    @Body()
    body: {
      accountId?: string;
      profileKey?: BankrollProfileKey;
      simulationName?: string;
      windowStart?: string;
      windowEnd?: string;
    }
  ) {
    const account = body.accountId
      ? await this.prisma.bankrollAccount.findUnique({ where: { id: body.accountId } })
      : await this.prisma.bankrollAccount.findFirst({ orderBy: { updatedAt: "desc" } });
    if (!account) {
      throw new Error("bankroll_account_not_found");
    }

    const profileKey = body.profileKey ?? account.profileDefault;
    const simulationName = body.simulationName ?? "manual_admin_simulation";

    return this.prisma.$transaction(async (tx) => {
      return this.simulationService.runHistoricalSimulation(tx, {
        bankrollAccountId: account.id,
        profileKey,
        simulationName,
        config: {
          source: "admin_api"
        },
        randomSeed: 42,
        windowStart: body.windowStart ? new Date(body.windowStart) : null,
        windowEnd: body.windowEnd ? new Date(body.windowEnd) : null
      });
    });
  }

  @Post("governance/evaluate")
  async evaluateGovernance(@Body() body: { accountId?: string }) {
    const account = body.accountId
      ? await this.prisma.bankrollAccount.findUnique({ where: { id: body.accountId } })
      : await this.prisma.bankrollAccount.findFirst({ orderBy: { updatedAt: "desc" } });

    if (!account) {
      throw new Error("bankroll_account_not_found");
    }

    return this.prisma.$transaction((tx) => this.roiGovernanceService.evaluate(tx, account.id));
  }
}
