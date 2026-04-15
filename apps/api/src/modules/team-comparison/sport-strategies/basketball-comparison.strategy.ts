import { Injectable } from "@nestjs/common";
import { BasketballComparisonConfidenceService } from "../basketball-comparison-confidence.service";
import { BasketballComparisonEngineService } from "../basketball-comparison-engine.service";
import { BasketballExplanationEngineService } from "../basketball-explanation-engine.service";
import { BasketballScenarioEngineService } from "../basketball-scenario-engine.service";
import { BasketballTeamFeatureAggregationService } from "../basketball-team-feature-aggregation.service";
import { BasketballTeamStrengthService } from "../basketball-team-strength.service";
import { TeamComparisonSportCode, TeamComparisonStrategy, TeamComparisonStrategyInput } from "./team-comparison.strategy";

@Injectable()
export class BasketballComparisonStrategy implements TeamComparisonStrategy {
  readonly sport: TeamComparisonSportCode = "basketball";

  constructor(
    private readonly aggregate: BasketballTeamFeatureAggregationService,
    private readonly strength: BasketballTeamStrengthService,
    private readonly comparisonEngine: BasketballComparisonEngineService,
    private readonly confidenceService: BasketballComparisonConfidenceService,
    private readonly scenarioEngine: BasketballScenarioEngineService,
    private readonly explanationEngine: BasketballExplanationEngineService
  ) {}

  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number(value.toFixed(4))));
  }

  private outcomeProbabilities(overallDelta: number) {
    const draw = 0.004;
    const homeWinRaw = 1 / (1 + Math.exp(-overallDelta * 7.5));
    const homeWin = this.clamp(homeWinRaw * (1 - draw), 0.02, 0.97);
    const awayWin = this.clamp((1 - draw) - homeWin, 0.02, 0.97);
    return {
      homeWin,
      draw,
      awayWin
    };
  }

  async compare(input: TeamComparisonStrategyInput) {
    const { homeResolved, awayResolved, seasonId } = input;
    const [homeFeatures, awayFeatures] = await Promise.all([
      this.aggregate.aggregate(homeResolved.equivalentIds, homeResolved.canonicalId, seasonId),
      this.aggregate.aggregate(awayResolved.equivalentIds, awayResolved.canonicalId, seasonId)
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

    return {
      homeTeamId: homeResolved.canonicalId,
      awayTeamId: awayResolved.canonicalId,
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
  }
}
