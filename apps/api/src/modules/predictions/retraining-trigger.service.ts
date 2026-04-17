import { Injectable } from "@nestjs/common";
import { Prisma, RetrainingTriggerType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelAliasService } from "./model-alias.service";

export type CreateRetrainingTriggerInput = {
  triggerType: RetrainingTriggerType;
  sport: string;
  market: string;
  line?: number | null;
  horizon: string;
  leagueId?: string | null;
  reasonPayload: Record<string, unknown>;
  sourceMetricSnapshot?: Record<string, unknown> | null;
  dedupKey?: string | null;
};

@Injectable()
export class RetrainingTriggerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelAliasService: ModelAliasService
  ) {}

  private dedupKey(input: CreateRetrainingTriggerInput) {
    if (input.dedupKey && input.dedupKey.trim().length > 0) {
      return input.dedupKey.trim();
    }
    const lineKey = this.modelAliasService.lineKey(input.line ?? null);
    const scopeLeagueKey = this.modelAliasService.scopeLeagueKey(input.leagueId ?? null);
    return [
      input.triggerType,
      input.sport.trim().toLowerCase(),
      input.market.trim().toLowerCase(),
      lineKey,
      input.horizon.trim().toUpperCase(),
      scopeLeagueKey
    ].join(":");
  }

  async createOrUpdate(input: CreateRetrainingTriggerInput) {
    const sport = input.sport.trim().toLowerCase();
    const market = input.market.trim().toLowerCase();
    const line = input.line ?? null;
    const lineKey = this.modelAliasService.lineKey(line);
    const horizon = input.horizon.trim().toUpperCase();
    const scopeLeagueKey = this.modelAliasService.scopeLeagueKey(input.leagueId ?? null);
    const dedupKey = this.dedupKey(input);

    return this.prisma.retrainingTrigger.upsert({
      where: { dedupKey },
      update: {
        status: "queued",
        reasonPayloadJson: input.reasonPayload as Prisma.InputJsonValue,
        sourceMetricSnapshotJson: (input.sourceMetricSnapshot ?? null) as Prisma.InputJsonValue,
        processedAt: null,
        finalActionTaken: null
      },
      create: {
        triggerType: input.triggerType,
        sportCode: sport,
        market,
        line,
        lineKey,
        horizon,
        leagueId: input.leagueId ?? null,
        scopeLeagueKey,
        reasonPayloadJson: input.reasonPayload as Prisma.InputJsonValue,
        sourceMetricSnapshotJson: (input.sourceMetricSnapshot ?? null) as Prisma.InputJsonValue,
        dedupKey,
        status: "queued"
      }
    });
  }

  async markProcessed(triggerId: string, action: string) {
    return this.prisma.retrainingTrigger.update({
      where: { id: triggerId },
      data: {
        status: "processed",
        finalActionTaken: action,
        processedAt: new Date()
      }
    });
  }
}
