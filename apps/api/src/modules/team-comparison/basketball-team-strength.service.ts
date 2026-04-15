import { Injectable } from "@nestjs/common";
import { BasketballTeamFeatureAggregate } from "./basketball-team-feature-aggregation.service";

export type BasketballTeamStrength = {
  shotQualityCreation: number;
  halfCourtOffense: number;
  transitionOffense: number;
  rimPressure: number;
  perimeterShotProfile: number;
  turnoverControl: number;
  offensiveRebounding: number;
  defensiveRebounding: number;
  rimDefense: number;
  perimeterDefense: number;
  foulDiscipline: number;
  benchImpact: number;
  starPowerReliability: number;
  paceControl: number;
  clutchStability: number;
  scheduleFreshness: number;
  overall: number;
};

@Injectable()
export class BasketballTeamStrengthService {
  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number(value.toFixed(4))));
  }

  compute(features: BasketballTeamFeatureAggregate): BasketballTeamStrength {
    const weightedOverall =
      features.shotQualityCreation * 0.09 +
      features.halfCourtOffense * 0.1 +
      features.transitionOffense * 0.07 +
      features.rimPressure * 0.07 +
      features.perimeterShotProfile * 0.06 +
      features.turnoverControl * 0.08 +
      features.offensiveRebounding * 0.07 +
      features.defensiveRebounding * 0.07 +
      features.rimDefense * 0.08 +
      features.perimeterDefense * 0.08 +
      features.foulDiscipline * 0.05 +
      features.benchImpact * 0.05 +
      features.starPowerReliability * 0.06 +
      features.paceControl * 0.04 +
      features.clutchStability * 0.06 +
      features.scheduleFreshness * 0.05;

    return {
      shotQualityCreation: this.clamp(features.shotQualityCreation, 0, 1),
      halfCourtOffense: this.clamp(features.halfCourtOffense, 0, 1),
      transitionOffense: this.clamp(features.transitionOffense, 0, 1),
      rimPressure: this.clamp(features.rimPressure, 0, 1),
      perimeterShotProfile: this.clamp(features.perimeterShotProfile, 0, 1),
      turnoverControl: this.clamp(features.turnoverControl, 0, 1),
      offensiveRebounding: this.clamp(features.offensiveRebounding, 0, 1),
      defensiveRebounding: this.clamp(features.defensiveRebounding, 0, 1),
      rimDefense: this.clamp(features.rimDefense, 0, 1),
      perimeterDefense: this.clamp(features.perimeterDefense, 0, 1),
      foulDiscipline: this.clamp(features.foulDiscipline, 0, 1),
      benchImpact: this.clamp(features.benchImpact, 0, 1),
      starPowerReliability: this.clamp(features.starPowerReliability, 0, 1),
      paceControl: this.clamp(features.paceControl, 0, 1),
      clutchStability: this.clamp(features.clutchStability, 0, 1),
      scheduleFreshness: this.clamp(features.scheduleFreshness, 0, 1),
      overall: this.clamp(weightedOverall, 0, 1)
    };
  }
}
