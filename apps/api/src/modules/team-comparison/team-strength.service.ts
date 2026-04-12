import { Injectable } from "@nestjs/common";

@Injectable()
export class TeamStrengthService {
  compute(features: {
    offense: number;
    defense: number;
    tempo: number;
    setPiece: number;
    transition: number;
    form: number;
  }) {
    return {
      ...features,
      cohesion: (features.form + features.defense) / 2,
      overall:
        features.offense * 0.25 +
        features.defense * 0.25 +
        features.tempo * 0.1 +
        features.setPiece * 0.1 +
        features.transition * 0.1 +
        features.form * 0.2
    };
  }
}
