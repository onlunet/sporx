import { Injectable } from "@nestjs/common";
import { BasketballRiskFlag } from "./basketball-feature.types";

@Injectable()
export class BasketballCalibrationService {
  private clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  private normalize(probabilities: { home: number; draw: number; away: number }) {
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

  calibrateOutcome(probabilities: { home: number; draw: number; away: number }) {
    const temperature = this.clamp(Number(process.env.BASKETBALL_CALIBRATION_TEMPERATURE ?? "1.03"), 0.85, 1.3);
    const scaled = {
      home: Math.pow(this.clamp(probabilities.home, 1e-6, 1), 1 / temperature),
      draw: Math.pow(this.clamp(probabilities.draw, 1e-6, 1), 1 / temperature),
      away: Math.pow(this.clamp(probabilities.away, 1e-6, 1), 1 / temperature)
    };
    return this.normalize(scaled);
  }

  calibrateBinary(over: number) {
    const temperature = this.clamp(Number(process.env.BASKETBALL_TOTAL_CALIBRATION_TEMPERATURE ?? "1.02"), 0.85, 1.25);
    const safeOver = this.clamp(over, 1e-6, 1 - 1e-6);
    const scaledOver = Math.pow(safeOver, 1 / temperature);
    const scaledUnder = Math.pow(1 - safeOver, 1 / temperature);
    const sum = scaledOver + scaledUnder || 1;
    const calibratedOver = scaledOver / sum;
    return {
      over: Number(calibratedOver.toFixed(4)),
      under: Number((1 - calibratedOver).toFixed(4))
    };
  }

  confidence(probabilities: { home: number; draw: number; away: number }, riskFlags: BasketballRiskFlag[]) {
    const sorted = [probabilities.home, probabilities.draw, probabilities.away].sort((a, b) => b - a);
    const top = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    const edge = Math.max(0, top - second);
    let confidence = top * 0.74 + edge * 0.26;

    for (const flag of riskFlags) {
      if (flag.severity === "high") {
        confidence -= 0.07;
      } else if (flag.severity === "medium") {
        confidence -= 0.03;
      } else {
        confidence -= 0.01;
      }
    }

    return Number(this.clamp(confidence, 0.24, 0.92).toFixed(4));
  }
}
