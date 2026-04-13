import { Injectable } from "@nestjs/common";
import { MarketOddsSummary } from "./odds-types";

type SnapshotLike = {
  bookmaker: string;
  impliedProbability: number;
  fairProbability: number | null;
  capturedAt: Date;
};

@Injectable()
export class OddsFeatureService {
  impliedProbabilityFromDecimalOdds(oddsValue: number) {
    if (!Number.isFinite(oddsValue) || oddsValue <= 1) {
      return 0;
    }
    return 1 / oddsValue;
  }

  removeBookmakerMargin(probabilities: number[]) {
    const clean = probabilities
      .map((value) => (Number.isFinite(value) && value > 0 ? value : 0))
      .filter((value) => value > 0);

    const sum = clean.reduce((acc, value) => acc + value, 0);
    if (sum <= 0) {
      return probabilities.map(() => 0);
    }
    return probabilities.map((value) => {
      const safe = Number.isFinite(value) && value > 0 ? value : 0;
      return safe / sum;
    });
  }

  private round4(value: number) {
    return Number(value.toFixed(4));
  }

  private stdDev(values: number[]) {
    if (values.length <= 1) {
      return 0;
    }
    const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
    const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  private latestByBookmaker(snapshots: SnapshotLike[]) {
    const map = new Map<string, SnapshotLike>();
    for (const snapshot of snapshots) {
      const previous = map.get(snapshot.bookmaker);
      if (!previous || previous.capturedAt.getTime() < snapshot.capturedAt.getTime()) {
        map.set(snapshot.bookmaker, snapshot);
      }
    }
    return [...map.values()];
  }

  summarizeMarketSnapshots(snapshots: SnapshotLike[], now = new Date()): MarketOddsSummary | null {
    if (snapshots.length === 0) {
      return null;
    }

    const sorted = [...snapshots].sort((left, right) => left.capturedAt.getTime() - right.capturedAt.getTime());
    const latestPerBookmaker = this.latestByBookmaker(sorted);
    const latestProbabilities = latestPerBookmaker.map((item) => item.impliedProbability);
    const latestMean = latestProbabilities.reduce((acc, value) => acc + value, 0) / latestProbabilities.length;

    const fairCandidates = latestPerBookmaker
      .map((item) => (item.fairProbability && Number.isFinite(item.fairProbability) ? item.fairProbability : null))
      .filter((item): item is number => item !== null);
    const fairMean =
      fairCandidates.length > 0
        ? fairCandidates.reduce((acc, value) => acc + value, 0) / fairCandidates.length
        : null;

    const openingByBookmaker = new Map<string, SnapshotLike>();
    for (const item of sorted) {
      if (!openingByBookmaker.has(item.bookmaker)) {
        openingByBookmaker.set(item.bookmaker, item);
      }
    }
    const openingRows = [...openingByBookmaker.values()];
    const openingMean =
      openingRows.length > 0
        ? openingRows.reduce((acc, value) => acc + value.impliedProbability, 0) / openingRows.length
        : latestMean;

    const movementDelta = latestMean - openingMean;
    const movementDirection = movementDelta > 0.01 ? "up" : movementDelta < -0.01 ? "down" : "flat";
    const spanMs = Math.max(1, sorted[sorted.length - 1].capturedAt.getTime() - sorted[0].capturedAt.getTime());
    const movementSpeed = Math.abs(movementDelta) / (spanMs / (60 * 60 * 1000));
    const volatilityScore = this.stdDev(sorted.map((item) => item.impliedProbability));
    const bookmakerDisagreement = this.stdDev(latestProbabilities);
    const consensusScore = Math.max(0, 1 - bookmakerDisagreement * 5);

    const newest = sorted[sorted.length - 1].capturedAt.getTime();
    const ageMinutes = Math.max(0, (now.getTime() - newest) / (60 * 1000));
    const freshnessScore = Math.max(0, 1 - ageMinutes / 180);

    return {
      marketImpliedProbability: this.round4(latestMean),
      fairMarketProbability: fairMean === null ? null : this.round4(fairMean),
      openingImpliedProbability: this.round4(openingMean),
      latestImpliedProbability: this.round4(latestMean),
      movementDirection,
      movementSpeed: this.round4(movementSpeed),
      volatilityScore: this.round4(volatilityScore),
      consensusScore: this.round4(consensusScore),
      bookmakerDisagreementScore: this.round4(bookmakerDisagreement),
      coverage: latestPerBookmaker.length,
      freshnessScore: this.round4(freshnessScore)
    };
  }
}
