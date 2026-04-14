import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { CacheService } from "../../cache/cache.service";
import { PrismaService } from "../../prisma/prisma.service";
import { ExpandedPredictionItem } from "../predictions/prediction-markets.util";
import { MarketAwarePredictionService } from "./market-aware-prediction.service";
import { MarketSignalsService } from "./market-signals.service";
import { OddsSchemaBootstrapService } from "./odds-schema-bootstrap.service";

type AnalysisMapValue = {
  modelProbability: number;
  marketImpliedProbability: number;
  fairMarketProbability: number | null;
  probabilityGap: number;
  movementDirection: string | null;
  volatilityScore: number | null;
  consensusScore: number | null;
  contradictionScore: number | null;
  createdAt: Date;
  marketLine: number | null;
};

type SnapshotsQuery = {
  matchId?: string;
  marketType?: string;
  line?: number;
  limit?: number;
};

type AnalysisQuery = {
  matchId?: string;
  predictionType?: string;
  line?: number;
  limit?: number;
};

@Injectable()
export class OddsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly marketSignalsService: MarketSignalsService,
    private readonly marketAwarePredictionService: MarketAwarePredictionService,
    private readonly oddsSchemaBootstrapService: OddsSchemaBootstrapService
  ) {}

  private round2(value: number | null | undefined) {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return null;
    }
    return Number(value.toFixed(2));
  }

  private key(matchId: string, predictionType: string, line: number | null) {
    return `${matchId}|${predictionType}|${line === null ? "null" : this.round2(line)}`;
  }

  private marketDistributionFromSelection(
    probabilities: Record<string, number>,
    selectedKey: string,
    selectedProbability: number
  ) {
    const entries = Object.entries(probabilities).filter(([, value]) => Number.isFinite(value));
    const modelSelected = probabilities[selectedKey] ?? 0;
    const others = entries.filter(([key]) => key !== selectedKey);
    if (others.length === 0) {
      return { [selectedKey]: Math.max(0, Math.min(1, selectedProbability)) };
    }

    const remaining = Math.max(0, 1 - selectedProbability);
    const otherModelSum = Math.max(0.0001, others.reduce((acc, [, value]) => acc + value, 0));
    const market: Record<string, number> = {
      [selectedKey]: Math.max(0, Math.min(1, selectedProbability))
    };
    for (const [key, value] of others) {
      market[key] = remaining * (value / otherModelSum);
    }

    if (modelSelected <= 0) {
      market[selectedKey] = selectedProbability;
    }
    return market;
  }

  private selectHighestProbability(probabilities: Record<string, number>) {
    let selectedKey = "";
    let selectedValue = -1;
    for (const [key, value] of Object.entries(probabilities)) {
      if (Number.isFinite(value) && value > selectedValue) {
        selectedKey = key;
        selectedValue = value;
      }
    }
    return {
      selectedKey,
      selectedValue: selectedValue > 0 ? selectedValue : 0
    };
  }

  private async latestAnalysisMap(
    items: ExpandedPredictionItem[],
    lineFilter?: number
  ): Promise<Map<string, AnalysisMapValue>> {
    if (items.length === 0) {
      return new Map();
    }

    const matchIds = [...new Set(items.map((item) => item.matchId))];
    const predictionTypes = [...new Set(items.map((item) => item.predictionType))];
    const where: Prisma.MarketAnalysisSnapshotWhereInput = {
      matchId: { in: matchIds },
      predictionType: { in: predictionTypes }
    };

    if (lineFilter !== undefined) {
      where.marketLine = lineFilter;
    }

    const oddsSchemaReady = await this.oddsSchemaBootstrapService.ensureReady();
    if (!oddsSchemaReady) {
      return new Map();
    }

    const rows = await this.prisma.marketAnalysisSnapshot.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.max(500, items.length * 6)
    });

    const map = new Map<string, AnalysisMapValue>();
    for (const row of rows) {
      const key = this.key(row.matchId, row.predictionType, row.marketLine ?? null);
      if (!map.has(key)) {
        map.set(key, {
          modelProbability: row.modelProbability,
          marketImpliedProbability: row.marketImpliedProbability,
          fairMarketProbability: row.fairMarketProbability,
          probabilityGap: row.probabilityGap,
          movementDirection: row.movementDirection,
          volatilityScore: row.volatilityScore,
          consensusScore: row.consensusScore,
          contradictionScore: row.contradictionScore,
          createdAt: row.createdAt,
          marketLine: row.marketLine ?? null
        });
      }
    }
    return map;
  }

  async attachMarketAnalysis(
    items: ExpandedPredictionItem[],
    includeMarketAnalysis = false,
    lineFilter?: number
  ) {
    if (!includeMarketAnalysis || items.length === 0) {
      return items;
    }

    const analysisMap = await this.latestAnalysisMap(items, lineFilter);

    return items.map((item) => {
      const analysis = analysisMap.get(this.key(item.matchId, item.predictionType, item.line ?? null));
      if (!analysis) {
        return item;
      }

      const probabilityEntries = Object.entries(item.probabilities);
      const shouldBlend = probabilityEntries.length >= 2;
      const selected = this.selectHighestProbability(item.probabilities);
      const marketDistribution = this.marketDistributionFromSelection(
        item.probabilities,
        selected.selectedKey,
        analysis.marketImpliedProbability
      );

      const blended = shouldBlend
        ? this.marketAwarePredictionService.blend(
            item.probabilities,
            marketDistribution,
            Math.max(0, analysis.contradictionScore ?? 0)
          )
        : item.probabilities;

      const adjustedConfidence = this.marketAwarePredictionService.marketAdjustedConfidence(
        item.confidenceScore,
        Math.max(0, analysis.contradictionScore ?? 0),
        1
      );

      const riskFlags = [...item.riskFlags];
      const marketRiskFlags = this.marketSignalsService.buildRiskFlags(
        {
          marketImpliedProbability: analysis.marketImpliedProbability,
          fairMarketProbability: analysis.fairMarketProbability,
          openingImpliedProbability: null,
          latestImpliedProbability: analysis.marketImpliedProbability,
          movementDirection:
            analysis.movementDirection === "up" || analysis.movementDirection === "down" ? analysis.movementDirection : "flat",
          movementSpeed: 0,
          volatilityScore: Math.max(0, analysis.volatilityScore ?? 0),
          consensusScore: Math.max(0, analysis.consensusScore ?? 0),
          bookmakerDisagreementScore: Math.max(0, 1 - (analysis.consensusScore ?? 0)),
          coverage: 1,
          freshnessScore: 1
        },
        {
          modelProbability: analysis.modelProbability,
          marketImpliedProbability: analysis.marketImpliedProbability,
          fairMarketProbability: analysis.fairMarketProbability,
          probabilityGap: analysis.probabilityGap,
          movementDirection:
            analysis.movementDirection === "up" || analysis.movementDirection === "down" ? analysis.movementDirection : "flat",
          volatilityScore: Math.max(0, analysis.volatilityScore ?? 0),
          consensusScore: Math.max(0, analysis.consensusScore ?? 0),
          contradictionScore: Math.max(0, analysis.contradictionScore ?? 0)
        }
      );

      const existingFlagCodes = new Set(riskFlags.map((flag) => flag.code));
      for (const marketFlag of marketRiskFlags) {
        if (!existingFlagCodes.has(marketFlag.code)) {
          riskFlags.push(marketFlag);
        }
      }

      const contradictionSignals = [
        ...item.contradictionSignals,
        ...(Math.abs(analysis.probabilityGap) > 0.01
          ? [
              {
                key: "market_gap",
                label: "Model-Piyasa Sapması",
                detail: `%${Math.round(Math.abs(analysis.probabilityGap) * 100)} fark`
              }
            ]
          : [])
      ];

      const supportingSignals = [
        ...item.supportingSignals,
        {
          key: "market_alignment",
          label: "Piyasa Uyum Seviyesi",
          value: this.marketSignalsService.agreementLevel(analysis.probabilityGap)
        }
      ];

      return {
        ...item,
        probabilities: blended,
        confidenceScore: adjustedConfidence,
        riskFlags,
        supportingSignals,
        contradictionSignals,
        marketAgreementLevel: this.marketSignalsService.agreementLevel(analysis.probabilityGap),
        marketImpliedProbabilities: {
          selected: analysis.marketImpliedProbability
        },
        movementSummary: {
          direction: analysis.movementDirection ?? "flat",
          volatilityScore: analysis.volatilityScore ?? 0
        },
        marketAnalysis: {
          modelProbability: analysis.modelProbability,
          marketImpliedProbability: analysis.marketImpliedProbability,
          fairMarketProbability: analysis.fairMarketProbability,
          probabilityGap: analysis.probabilityGap,
          movementDirection: analysis.movementDirection ?? "flat",
          volatilityScore: analysis.volatilityScore ?? 0,
          consensusScore: analysis.consensusScore ?? 0,
          contradictionScore: analysis.contradictionScore ?? 0,
          updatedAt: analysis.createdAt.toISOString(),
          line: analysis.marketLine
        }
      };
    });
  }

  async listSnapshots(params: SnapshotsQuery) {
    const oddsSchemaReady = await this.oddsSchemaBootstrapService.ensureReady();
    if (!oddsSchemaReady) {
      return [];
    }

    const take = Math.max(1, Math.min(500, params.limit ?? 200));
    return this.prisma.oddsSnapshot.findMany({
      where: {
        ...(params.matchId ? { matchId: params.matchId } : {}),
        ...(params.marketType ? { marketType: params.marketType } : {}),
        ...(params.line !== undefined ? { line: params.line } : {})
      },
      orderBy: { capturedAt: "desc" },
      take
    });
  }

  async listMarketAnalysis(params: AnalysisQuery) {
    const oddsSchemaReady = await this.oddsSchemaBootstrapService.ensureReady();
    if (!oddsSchemaReady) {
      return [];
    }

    const take = Math.max(1, Math.min(500, params.limit ?? 200));
    return this.prisma.marketAnalysisSnapshot.findMany({
      where: {
        ...(params.matchId ? { matchId: params.matchId } : {}),
        ...(params.predictionType ? { predictionType: params.predictionType } : {}),
        ...(params.line !== undefined ? { marketLine: params.line } : {})
      },
      orderBy: { createdAt: "desc" },
      take
    });
  }

  async listDisagreements(threshold = 0.12, limit = 200) {
    const oddsSchemaReady = await this.oddsSchemaBootstrapService.ensureReady();
    if (!oddsSchemaReady) {
      return [];
    }

    return this.prisma.marketAnalysisSnapshot.findMany({
      where: {
        contradictionScore: { gte: threshold }
      },
      orderBy: [{ contradictionScore: "desc" }, { createdAt: "desc" }],
      take: Math.max(1, Math.min(500, limit))
    });
  }

  async marketPerformance() {
    const oddsSchemaReady = await this.oddsSchemaBootstrapService.ensureReady();
    if (!oddsSchemaReady) {
      return [];
    }

    const cacheKey = "odds:market-performance:v1";
    const cached = await this.cache.get<unknown[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const rows = await this.prisma.marketAnalysisSnapshot.findMany({
      orderBy: { createdAt: "desc" },
      take: 5000
    });

    const groups = new Map<
      string,
      {
        predictionType: string;
        count: number;
        absGapTotal: number;
        contradictionTotal: number;
        consensusTotal: number;
      }
    >();

    for (const row of rows) {
      const current = groups.get(row.predictionType) ?? {
        predictionType: row.predictionType,
        count: 0,
        absGapTotal: 0,
        contradictionTotal: 0,
        consensusTotal: 0
      };
      current.count += 1;
      current.absGapTotal += Math.abs(row.probabilityGap);
      current.contradictionTotal += Math.max(0, row.contradictionScore ?? 0);
      current.consensusTotal += Math.max(0, row.consensusScore ?? 0);
      groups.set(row.predictionType, current);
    }

    const result = [...groups.values()].map((group) => ({
      predictionType: group.predictionType,
      sampleSize: group.count,
      avgAbsProbabilityGap: Number((group.absGapTotal / group.count).toFixed(4)),
      avgContradictionScore: Number((group.contradictionTotal / group.count).toFixed(4)),
      avgConsensusScore: Number((group.consensusTotal / group.count).toFixed(4))
    }));

    await this.cache.set(cacheKey, result, 60, ["market-analysis"]);
    return result;
  }
}
