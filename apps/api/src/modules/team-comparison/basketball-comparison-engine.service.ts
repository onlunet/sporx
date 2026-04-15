import { Injectable } from "@nestjs/common";
import { BasketballTeamStrength } from "./basketball-team-strength.service";

type Advantage = "home" | "away" | "neutral";

@Injectable()
export class BasketballComparisonEngineService {
  private readonly keys: Array<keyof BasketballTeamStrength> = [
    "shotQualityCreation",
    "halfCourtOffense",
    "transitionOffense",
    "rimPressure",
    "perimeterShotProfile",
    "turnoverControl",
    "offensiveRebounding",
    "defensiveRebounding",
    "rimDefense",
    "perimeterDefense",
    "foulDiscipline",
    "benchImpact",
    "starPowerReliability",
    "paceControl",
    "clutchStability",
    "scheduleFreshness",
    "overall"
  ];

  compare(home: BasketballTeamStrength, away: BasketballTeamStrength) {
    return this.keys.map((key) => {
      const homeValue = Number(home[key] ?? 0);
      const awayValue = Number(away[key] ?? 0);
      const delta = homeValue - awayValue;
      const threshold = key === "overall" ? 0.025 : 0.04;
      const advantage: Advantage = Math.abs(delta) < threshold ? "neutral" : delta > 0 ? "home" : "away";
      return {
        key,
        homeValue: Number(homeValue.toFixed(4)),
        awayValue: Number(awayValue.toFixed(4)),
        advantage
      };
    });
  }
}
