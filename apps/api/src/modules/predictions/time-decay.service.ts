import { Injectable } from "@nestjs/common";

type DecaySample = {
  value: number;
  daysAgo: number;
};

@Injectable()
export class TimeDecayService {
  private readonly defaultLambda = 0.035;

  weight(daysAgo: number, lambda = this.defaultLambda) {
    const safeDays = Number.isFinite(daysAgo) ? Math.max(0, daysAgo) : 0;
    const safeLambda = Number.isFinite(lambda) ? Math.max(0.0001, lambda) : this.defaultLambda;
    return Number(Math.exp(-safeLambda * safeDays).toFixed(6));
  }

  weightedAverage(samples: DecaySample[], lambda = this.defaultLambda, fallback = 0.5) {
    if (samples.length === 0) {
      return fallback;
    }

    let numerator = 0;
    let denominator = 0;
    for (const sample of samples) {
      const value = Number.isFinite(sample.value) ? sample.value : fallback;
      const weight = this.weight(sample.daysAgo, lambda);
      numerator += value * weight;
      denominator += weight;
    }

    if (denominator <= 0) {
      return fallback;
    }
    return numerator / denominator;
  }
}

