import { Injectable } from "@nestjs/common";
import {
  BasketballCoreProjection,
  BasketballFeatureSnapshot,
  BasketballPossessionProjection
} from "./basketball-feature.types";

@Injectable()
export class BasketballRatingModelService {
  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private normalizeProbabilities(probabilities: { home: number; draw: number; away: number }) {
    const safe = {
      home: this.clamp(probabilities.home, 0, 1),
      draw: this.clamp(probabilities.draw, 0, 1),
      away: this.clamp(probabilities.away, 0, 1)
    };
    const sum = safe.home + safe.draw + safe.away || 1;
    return {
      home: Number((safe.home / sum).toFixed(4)),
      draw: Number((safe.draw / sum).toFixed(4)),
      away: Number((safe.away / sum).toFixed(4))
    };
  }

  private overProbability(expectedTotal: number, line: number) {
    const scaled = (expectedTotal - line) / 11.5;
    return this.clamp(1 / (1 + Math.exp(-scaled)), 0.05, 0.95);
  }

  private outcomeProbabilities(spreadHome: number) {
    const home = this.clamp(1 / (1 + Math.exp(-spreadHome / 7.4)), 0.05, 0.94);
    const draw = 0.004;
    const away = Math.max(0.002, 1 - home - draw);
    return this.normalizeProbabilities({ home, draw, away });
  }

  project(
    features: BasketballFeatureSnapshot,
    possession: BasketballPossessionProjection
  ): BasketballCoreProjection {
    const expectedPossessions = possession.expectedPossessions;
    const homeOff = features.home.offensiveRating;
    const awayOff = features.away.offensiveRating;
    const homeDef = features.home.defensiveRating;
    const awayDef = features.away.defensiveRating;

    const homeDefenseAdjustment = this.clamp((112 - awayDef) / 100, 0.88, 1.12);
    const awayDefenseAdjustment = this.clamp((112 - homeDef) / 100, 0.88, 1.12);
    const homeRestBoost = features.home.backToBack ? -1.2 : Math.min(1.8, features.home.restDays * 0.22);
    const awayRestBoost = features.away.backToBack ? -1.2 : Math.min(1.8, features.away.restDays * 0.22);
    const homeCourtAdvantage = 2.1;
    const fatigueDiff = (features.away.travelLoad - features.home.travelLoad) * 2.4;
    const lineupDiff =
      (features.home.playerAvailabilityScore + features.home.topUsageAvailabilityScore) / 2 -
      (features.away.playerAvailabilityScore + features.away.topUsageAvailabilityScore) / 2;

    const homeExpectedPoints = this.clamp(
      expectedPossessions * (homeOff / 100) * homeDefenseAdjustment +
        homeCourtAdvantage +
        homeRestBoost -
        awayRestBoost +
        fatigueDiff +
        lineupDiff * 6,
      74,
      145
    );
    const awayExpectedPoints = this.clamp(
      expectedPossessions * (awayOff / 100) * awayDefenseAdjustment - homeCourtAdvantage - homeRestBoost + awayRestBoost,
      70,
      141
    );

    const expectedTotal = Number((homeExpectedPoints + awayExpectedPoints).toFixed(2));
    const expectedSpreadHome = Number((homeExpectedPoints - awayExpectedPoints).toFixed(2));
    const outcome = this.outcomeProbabilities(expectedSpreadHome);

    const firstHalfSpread = expectedSpreadHome * 0.48;
    const firstHalf = this.outcomeProbabilities(firstHalfSpread);
    const firstHalfTotal = Number((expectedTotal * 0.485).toFixed(2));
    const secondHalfTotal = Number((expectedTotal - firstHalfTotal).toFixed(2));

    const lineBase = Math.round(expectedTotal / 5) * 5 + 0.5;
    const lines = [lineBase - 10, lineBase - 5, lineBase, lineBase + 5];
    const totalLineProbabilities = lines.map((line) => {
      const over = this.overProbability(expectedTotal, line);
      return {
        line: Number(line.toFixed(1)),
        over: Number(over.toFixed(4)),
        under: Number((1 - over).toFixed(4))
      };
    });

    return {
      homeExpectedPoints: Number(homeExpectedPoints.toFixed(2)),
      awayExpectedPoints: Number(awayExpectedPoints.toFixed(2)),
      expectedTotal,
      expectedSpreadHome,
      projectedFirstHalfTotal: firstHalfTotal,
      projectedSecondHalfTotal: secondHalfTotal,
      outcomeProbabilities: outcome,
      firstHalfProbabilities: firstHalf,
      totalLineProbabilities
    };
  }
}
