import { Injectable } from "@nestjs/common";
import { stableHash } from "./research-lab.hash";
import { TimeWindow } from "./research-lab.types";

type BuildWindowsInput = {
  mode: "FIXED" | "ROLLING" | "ANCHORED" | "SEASON";
  rangeStart: Date;
  rangeEnd: Date;
  trainDays: number;
  validationDays: number;
  testDays: number;
  stepDays?: number;
  seasonBoundaries?: Array<{ seasonKey: string; start: Date; end: Date }>;
};

type LeakageCheckInput = {
  rows: Array<Record<string, unknown>>;
  cutoffAt: Date;
  timestampField: string;
};

@Injectable()
export class TimeOrderedEvaluationService {
  private days(value: number) {
    return Math.max(1, Math.floor(value)) * 24 * 60 * 60 * 1000;
  }

  private toDate(value: unknown): Date | null {
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === "string" || typeof value === "number") {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
  }

  buildWindows(input: BuildWindowsInput): TimeWindow[] {
    const trainMs = this.days(input.trainDays);
    const validationMs = this.days(input.validationDays);
    const testMs = this.days(input.testDays);
    const stepMs = this.days(input.stepDays ?? input.testDays);

    if (input.mode === "FIXED") {
      const trainStart = new Date(input.rangeStart);
      const trainEnd = new Date(trainStart.getTime() + trainMs);
      const validationStart = new Date(trainEnd.getTime());
      const validationEnd = new Date(validationStart.getTime() + validationMs);
      const testStart = new Date(validationEnd.getTime());
      const testEnd = new Date(testStart.getTime() + testMs);
      if (testEnd.getTime() > input.rangeEnd.getTime()) {
        return [];
      }
      return [
        {
          key: "fixed-0",
          trainStart,
          trainEnd,
          validationStart,
          validationEnd,
          testStart,
          testEnd
        }
      ];
    }

    if (input.mode === "SEASON") {
      const seasons = [...(input.seasonBoundaries ?? [])].sort((left, right) => left.start.getTime() - right.start.getTime());
      const windows: TimeWindow[] = [];
      for (let index = 0; index < seasons.length; index += 1) {
        const season = seasons[index];
        const start = new Date(Math.max(season.start.getTime(), input.rangeStart.getTime()));
        const end = new Date(Math.min(season.end.getTime(), input.rangeEnd.getTime()));
        if (end.getTime() <= start.getTime()) {
          continue;
        }

        const trainStart = new Date(start);
        const trainEnd = new Date(Math.min(start.getTime() + trainMs, end.getTime()));
        const validationStart = new Date(trainEnd);
        const validationEnd = new Date(Math.min(validationStart.getTime() + validationMs, end.getTime()));
        const testStart = new Date(validationEnd);
        const testEnd = new Date(Math.min(testStart.getTime() + testMs, end.getTime()));
        if (testEnd.getTime() <= testStart.getTime()) {
          continue;
        }
        windows.push({
          key: `season-${season.seasonKey}`,
          trainStart,
          trainEnd,
          validationStart,
          validationEnd,
          testStart,
          testEnd
        });
      }
      return windows;
    }

    const windows: TimeWindow[] = [];
    let trainStartMs = input.rangeStart.getTime();
    while (true) {
      const trainEndMs = trainStartMs + trainMs;
      const validationEndMs = trainEndMs + validationMs;
      const testEndMs = validationEndMs + testMs;
      if (testEndMs > input.rangeEnd.getTime()) {
        break;
      }

      windows.push({
        key: `win-${windows.length}`,
        trainStart: new Date(trainStartMs),
        trainEnd: new Date(trainEndMs),
        validationStart: new Date(trainEndMs),
        validationEnd: new Date(validationEndMs),
        testStart: new Date(validationEndMs),
        testEnd: new Date(testEndMs)
      });

      if (input.mode === "ANCHORED") {
        trainStartMs = input.rangeStart.getTime() + stepMs * (windows.length);
        const anchored = windows[windows.length - 1];
        anchored.trainStart = new Date(input.rangeStart);
      } else {
        trainStartMs += stepMs;
      }
    }

    if (input.mode === "ANCHORED") {
      return windows.map((window, index) => ({
        ...window,
        key: `anchored-${index}`,
        trainStart: new Date(input.rangeStart)
      }));
    }

    return windows;
  }

  findLeakageViolations(input: LeakageCheckInput) {
    const violations: Array<{ index: number; timestamp: string; cutoffAt: string; field: string }> = [];
    for (let index = 0; index < input.rows.length; index += 1) {
      const row = input.rows[index];
      const timestamp = this.toDate(row[input.timestampField]);
      if (!timestamp) {
        continue;
      }
      if (timestamp.getTime() > input.cutoffAt.getTime()) {
        violations.push({
          index,
          timestamp: timestamp.toISOString(),
          cutoffAt: input.cutoffAt.toISOString(),
          field: input.timestampField
        });
      }
    }
    return violations;
  }

  assertPointInTime(input: LeakageCheckInput) {
    const violations = this.findLeakageViolations(input);
    if (violations.length > 0) {
      throw new Error(`time_ordered_leakage_detected:${JSON.stringify(violations.slice(0, 5))}`);
    }
  }

  hashWindow(window: TimeWindow) {
    return stableHash({
      key: window.key,
      trainStart: window.trainStart.toISOString(),
      trainEnd: window.trainEnd.toISOString(),
      validationStart: window.validationStart.toISOString(),
      validationEnd: window.validationEnd.toISOString(),
      testStart: window.testStart.toISOString(),
      testEnd: window.testEnd.toISOString()
    });
  }
}
