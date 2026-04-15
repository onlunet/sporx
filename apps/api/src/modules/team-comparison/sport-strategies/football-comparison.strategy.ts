import { Injectable } from "@nestjs/common";
import { TeamFeatureAggregationService } from "../team-feature-aggregation.service";
import { TeamStrengthService } from "../team-strength.service";
import { ComparisonEngineService } from "../comparison-engine.service";
import { ScenarioEngineService } from "../scenario-engine.service";
import { ExplanationEngineService } from "../explanation-engine.service";
import { ComparisonConfidenceService } from "../comparison-confidence.service";
import { TeamComparisonSportCode, TeamComparisonStrategy, TeamComparisonStrategyInput } from "./team-comparison.strategy";

@Injectable()
export class FootballComparisonStrategy implements TeamComparisonStrategy {
  readonly sport: TeamComparisonSportCode = "football";

  constructor(
    private readonly aggregate: TeamFeatureAggregationService,
    private readonly strength: TeamStrengthService,
    private readonly comparisonEngine: ComparisonEngineService,
    private readonly scenarioEngine: ScenarioEngineService,
    private readonly explanationEngine: ExplanationEngineService,
    private readonly confidenceService: ComparisonConfidenceService
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

