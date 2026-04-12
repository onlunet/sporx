import { Injectable } from "@nestjs/common";

@Injectable()
export class ProxyXGService {
  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, Number(value.toFixed(4))));
  }

  estimate(goalsFor: number, goalsAgainst: number, matches: number) {
    if (matches === 0) {
      return { attack: 0.95, defense: 0.95 };
    }

    const goalsForPerMatch = goalsFor / matches;
    const goalsAgainstPerMatch = goalsAgainst / matches;

    return {
      attack: this.clamp(0.4 + goalsForPerMatch * 0.5, 0.35, 1.8),
      defense: this.clamp(1.6 - goalsAgainstPerMatch * 0.5, 0.35, 1.8)
    };
  }
}
