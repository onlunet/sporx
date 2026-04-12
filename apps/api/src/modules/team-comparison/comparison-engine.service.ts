import { Injectable } from "@nestjs/common";

type Advantage = "home" | "away" | "neutral";

@Injectable()
export class ComparisonEngineService {
  compare(home: Record<string, number>, away: Record<string, number>) {
    const keys = ["offense", "defense", "tempo", "setPiece", "transition", "cohesion", "overall"];

    return keys.map((key) => {
      const homeValue = Number(home[key] ?? 0);
      const awayValue = Number(away[key] ?? 0);
      const delta = homeValue - awayValue;
      const advantage: Advantage = Math.abs(delta) < 0.03 ? "neutral" : delta > 0 ? "home" : "away";

      return {
        key,
        homeValue: Number(homeValue.toFixed(4)),
        awayValue: Number(awayValue.toFixed(4)),
        advantage
      };
    });
  }
}
