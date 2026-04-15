import { Injectable } from "@nestjs/common";
import { BasketballFeatureSnapshot, BasketballPossessionProjection } from "./basketball-feature.types";

@Injectable()
export class BasketballPossessionModelService {
  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  project(features: BasketballFeatureSnapshot): BasketballPossessionProjection {
    const basePace = (features.home.pace + features.away.pace) / 2;
    const paceStyleDelta = (features.home.attackMomentum - features.away.defenseFragility) * 1.8;
    const fatiguePenalty = features.context.scheduleFatigueScore * 1.7;
    const playoffPenalty = features.context.playoff ? 1.2 : 0;
    const estimated = this.clamp(basePace + paceStyleDelta - fatiguePenalty - playoffPenalty, 86, 113);

    const paceBucket: BasketballPossessionProjection["paceBucket"] =
      estimated <= 95 ? "slow" : estimated >= 102 ? "fast" : "balanced";

    return {
      expectedPossessions: Number(estimated.toFixed(2)),
      paceBucket
    };
  }
}
