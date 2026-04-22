import { Injectable } from "@nestjs/common";

interface EloInput {
  homeElo: number;
  awayElo: number;
}

@Injectable()
export class PredictionEngineService {
  private readonly kHomeAdvantage = 18;
  private readonly minDraw = 0.18;
  private readonly maxDraw = 0.3;
  private readonly homeGoalBaseline = 1.28;
  private readonly awayGoalBaseline = 1.18;

  computeEloProbabilities(input: EloInput) {
    const adjustedHome = input.homeElo + this.kHomeAdvantage;
    const homeWinShare = 1 / (1 + Math.pow(10, (input.awayElo - adjustedHome) / 400));
    const eloGap = Math.abs(adjustedHome - input.awayElo);
    const draw = Math.max(this.minDraw, Math.min(this.maxDraw, 0.28 - eloGap / 2200));
    const remaining = Math.max(0, 1 - draw);
    const homeWin = remaining * homeWinShare;
    const awayWin = Math.max(0, remaining - homeWin);

    return {
      home: Number(homeWin.toFixed(4)),
      draw: Number(draw.toFixed(4)),
      away: Number(awayWin.toFixed(4))
    };
  }

  poissonExpectedScore(homeAttack: number, awayAttack: number, homeDefense: number, awayDefense: number) {
    const homeLambda = Math.max(0.2, homeAttack * awayDefense * this.homeGoalBaseline);
    const awayLambda = Math.max(0.2, awayAttack * homeDefense * this.awayGoalBaseline);

    return {
      home: Number(homeLambda.toFixed(3)),
      away: Number(awayLambda.toFixed(3))
    };
  }

  calibrate(probabilities: { home: number; draw: number; away: number }, factor = 0.97) {
    const exponent = Math.max(0.8, Math.min(1.2, factor));
    const scaled = {
      home: Math.pow(Math.max(1e-6, probabilities.home), exponent),
      draw: Math.pow(Math.max(1e-6, probabilities.draw), exponent),
      away: Math.pow(Math.max(1e-6, probabilities.away), exponent)
    };
    const sum = scaled.home + scaled.draw + scaled.away;

    return {
      home: Number((scaled.home / sum).toFixed(4)),
      draw: Number((scaled.draw / sum).toFixed(4)),
      away: Number((scaled.away / sum).toFixed(4))
    };
  }

  confidence(probabilities: { home: number; draw: number; away: number }) {
    const sorted = [probabilities.home, probabilities.draw, probabilities.away].sort((left, right) => right - left);
    const top = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    const score = top * 0.75 + (top - second) * 0.25;
    return Number(score.toFixed(4));
  }

  riskFlags(confidence: number) {
    const flags: Array<{ code: string; severity: string; message: string }> = [];
    if (confidence < 0.55) {
      flags.push({ code: "LOW_CONFIDENCE", severity: "high", message: "Prediction confidence is low." });
    }
    if (confidence >= 0.55 && confidence < 0.65) {
      flags.push({ code: "MEDIUM_VARIANCE", severity: "medium", message: "Outcome variance is elevated." });
    }
    return flags;
  }
}
