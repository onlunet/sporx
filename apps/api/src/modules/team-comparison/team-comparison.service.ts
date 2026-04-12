import { Injectable, NotFoundException } from "@nestjs/common";
import { CacheService } from "../../cache/cache.service";
import { TeamFeatureAggregationService } from "./team-feature-aggregation.service";
import { TeamStrengthService } from "./team-strength.service";
import { ComparisonEngineService } from "./comparison-engine.service";
import { ScenarioEngineService } from "./scenario-engine.service";
import { ExplanationEngineService } from "./explanation-engine.service";
import { ComparisonConfidenceService } from "./comparison-confidence.service";
import { TeamIdentityService } from "../teams/team-identity.service";

@Injectable()
export class TeamComparisonService {
  constructor(
    private readonly cache: CacheService,
    private readonly aggregate: TeamFeatureAggregationService,
    private readonly strength: TeamStrengthService,
    private readonly comparisonEngine: ComparisonEngineService,
    private readonly scenarioEngine: ScenarioEngineService,
    private readonly explanationEngine: ExplanationEngineService,
    private readonly confidenceService: ComparisonConfidenceService,
    private readonly teamIdentityService: TeamIdentityService
  ) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number(value.toFixed(4))));
  }

  private outcomeProbabilities(overallDelta: number) {
    const centered = 1 / (1 + Math.exp(-overallDelta * 3));
    const draw = this.clamp(0.22 - Math.min(0.08, Math.abs(overallDelta) * 0.08), 0.14, 0.24);
    const remaining = 1 - draw;
    const homeWin = this.clamp(centered * remaining, 0, 1);
    const awayWin = this.clamp(remaining - homeWin, 0, 1);

    return {
      homeWin,
      draw,
      awayWin
    };
  }

  async compareTeams(homeTeamId: string, awayTeamId: string, seasonId?: string) {
    if (!homeTeamId || !awayTeamId) {
      throw new NotFoundException("Takim secimi eksik.");
    }

    const [homeResolved, awayResolved] = await Promise.all([
      this.teamIdentityService.resolveCanonicalTeam(homeTeamId),
      this.teamIdentityService.resolveCanonicalTeam(awayTeamId)
    ]);

    if (homeResolved.canonicalId === awayResolved.canonicalId) {
      throw new NotFoundException("Ayni takimi karsilastirmak mumkun degil.");
    }

    const canonicalHomeId = homeResolved.canonicalId;
    const canonicalAwayId = awayResolved.canonicalId;
    const cacheKey = `compare:${canonicalHomeId}:${canonicalAwayId}:${seasonId ?? "none"}`;
    const cached = await this.cache.get<unknown>(cacheKey);
    if (cached) {
      return cached;
    }

    const [homeFeatures, awayFeatures] = await Promise.all([
      this.aggregate.aggregate(homeResolved.equivalentIds, canonicalHomeId, seasonId),
      this.aggregate.aggregate(awayResolved.equivalentIds, canonicalAwayId, seasonId)
    ]);

    const homeStrength = this.strength.compute(homeFeatures);
    const awayStrength = this.strength.compute(awayFeatures);

    const axes = this.comparisonEngine.compare(homeStrength, awayStrength);
    const confidenceScore = this.confidenceService.compute(axes, {
      homeSampleSize: homeFeatures.scoredSampleSize,
      awaySampleSize: awayFeatures.scoredSampleSize,
      fallbackUsed: homeFeatures.fallbackUsed || awayFeatures.fallbackUsed
    });
    const scenarioNotes = this.scenarioEngine.generate(axes);
    const summary = this.explanationEngine.summarize(axes, confidenceScore, {
      homeSampleSize: homeFeatures.scoredSampleSize,
      awaySampleSize: awayFeatures.scoredSampleSize,
      fallbackUsed: homeFeatures.fallbackUsed || awayFeatures.fallbackUsed
    });

    const overallDelta = Number((homeStrength.overall - awayStrength.overall).toFixed(4));

    const result = {
      homeTeamId: canonicalHomeId,
      awayTeamId: canonicalAwayId,
      homeTeamName: homeResolved.canonicalTeam.name,
      awayTeamName: awayResolved.canonicalTeam.name,
      confidenceScore,
      summary,
      scenarioNotes,
      axes,
      outcomeProbabilities: this.outcomeProbabilities(overallDelta),
      analysisMeta: {
        homeSampleSize: homeFeatures.sampleSize,
        awaySampleSize: awayFeatures.sampleSize,
        homeScoredSampleSize: homeFeatures.scoredSampleSize,
        awayScoredSampleSize: awayFeatures.scoredSampleSize,
        fallbackUsed: homeFeatures.fallbackUsed || awayFeatures.fallbackUsed
      }
    };

    await this.cache.set(cacheKey, result, 300, ["compare"]);
    return result;
  }
}
