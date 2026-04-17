import { Injectable } from "@nestjs/common";
import { Prisma, ServingAliasType } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ModelAliasService } from "./model-alias.service";

type RollbackInput = {
  sport: string;
  market: string;
  line?: number | null;
  horizon: string;
  leagueId?: string | null;
  toModelVersionId: string;
  toCalibrationVersionId?: string | null;
  actor?: string | null;
  reason: string;
  effectiveAt?: Date | null;
  metadata?: Record<string, unknown> | null;
};

@Injectable()
export class RollbackDecisionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly modelAliasService: ModelAliasService
  ) {}

  async rollbackChampion(input: RollbackInput) {
    const current = await this.modelAliasService.resolveServingAlias({
      sport: input.sport,
      market: input.market,
      line: input.line ?? null,
      lineKey: this.modelAliasService.lineKey(input.line ?? null),
      horizon: input.horizon,
      leagueId: input.leagueId ?? null
    });

    const alias = await this.modelAliasService.switchAlias({
      sport: input.sport,
      market: input.market,
      line: input.line ?? null,
      horizon: input.horizon,
      leagueId: input.leagueId ?? null,
      aliasType: ServingAliasType.CHAMPION,
      modelVersionId: input.toModelVersionId,
      calibrationVersionId: input.toCalibrationVersionId ?? null,
      actor: input.actor ?? "system",
      reason: input.reason,
      effectiveAt: input.effectiveAt ?? new Date()
    });

    const rollbackEvent = await this.prisma.rollbackEvent.create({
      data: {
        sportCode: input.sport.trim().toLowerCase(),
        market: input.market.trim().toLowerCase(),
        line: input.line ?? null,
        lineKey: this.modelAliasService.lineKey(input.line ?? null),
        horizon: input.horizon.trim().toUpperCase(),
        leagueId: input.leagueId ?? null,
        scopeLeagueKey: this.modelAliasService.scopeLeagueKey(input.leagueId ?? null),
        fromModelVersionId: current.modelVersionId,
        toModelVersionId: input.toModelVersionId,
        fromCalibrationVersionId: current.calibrationVersionId,
        toCalibrationVersionId: input.toCalibrationVersionId ?? null,
        reason: input.reason,
        actor: input.actor ?? "system",
        effectiveAt: input.effectiveAt ?? new Date(),
        metadataJson: {
          previousAliasResolution: current,
          aliasId: alias.id,
          ...(input.metadata ?? {})
        } as Prisma.InputJsonValue
      }
    });

    return {
      alias,
      rollbackEvent
    };
  }
}
