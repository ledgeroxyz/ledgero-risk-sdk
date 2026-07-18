import { describe, expect, it } from "vitest";
import { calibrationReport, type CalibrationSample } from "../src/calibration.js";
import { RiskModelError } from "../src/types.js";

/**
 * Build `count` samples all sharing the same `predictedScore`, with
 * exactly `trueCount` of them flagged as the adverse outcome. Lets tests
 * construct a dataset with an *exact*, known predicted-vs-actual
 * relationship rather than relying on randomness.
 */
function repeatedSamples(
  predictedScore: number,
  count: number,
  trueCount: number,
): CalibrationSample[] {
  return Array.from({ length: count }, (_, i) => ({
    predictedScore,
    actualOutcome: i < trueCount,
  }));
}

describe("calibrationReport — validation", () => {
  it("throws on an empty sample set", () => {
    expect(() => calibrationReport([])).toThrow(RiskModelError);
  });

  it("throws on an out-of-range predictedScore", () => {
    expect(() =>
      calibrationReport([{ predictedScore: 150, actualOutcome: true }]),
    ).toThrow(RiskModelError);
    expect(() =>
      calibrationReport([{ predictedScore: -1, actualOutcome: false }]),
    ).toThrow(RiskModelError);
  });

  it("throws on a non-positive-integer bucketCount", () => {
    const samples = [{ predictedScore: 50, actualOutcome: true }];
    expect(() => calibrationReport(samples, { bucketCount: 0 })).toThrow(RiskModelError);
    expect(() => calibrationReport(samples, { bucketCount: 2.5 })).toThrow(RiskModelError);
  });
});

describe("calibrationReport — well-calibrated synthetic dataset", () => {
  // Three groups, each internally consistent: predictedDefaultRate ==
  // actualDefaultRate exactly, by construction.
  const samples: CalibrationSample[] = [
    ...repeatedSamples(90, 20, 2), // predicted default prob 0.10, actual 2/20 = 0.10
    ...repeatedSamples(10, 20, 18), // predicted default prob 0.90, actual 18/20 = 0.90
    ...repeatedSamples(50, 20, 10), // predicted default prob 0.50, actual 10/20 = 0.50
  ];

  it("reports zero mean absolute calibration gap when perfectly calibrated", () => {
    const report = calibrationReport(samples);
    expect(report.meanAbsoluteCalibrationGap).toBeCloseTo(0);
  });

  it("computes the expected Brier score", () => {
    const report = calibrationReport(samples);
    // Hand-computed: (1.8 + 1.8 + 5.0) / 60 = 0.14333...
    expect(report.brierScore).toBeCloseTo(8.6 / 60, 6);
  });

  it("computes matching overall predicted and actual default rates", () => {
    const report = calibrationReport(samples);
    expect(report.overallPredictedDefaultRate).toBeCloseTo(0.5);
    expect(report.overallActualDefaultRate).toBeCloseTo(0.5);
  });

  it("reports zero calibration gap per populated bucket", () => {
    const report = calibrationReport(samples);
    for (const bucket of report.buckets) {
      if (bucket.sampleCount > 0) {
        expect(bucket.calibrationGap).toBeCloseTo(0);
      }
    }
  });

  it("places samples into the correct score-range buckets", () => {
    const report = calibrationReport(samples);
    // score 90 with default bucketCount 10 -> bucket index 9, range [90, 100]
    const bucketFor90 = report.buckets[9]!;
    expect(bucketFor90.scoreRangeMin).toBe(90);
    expect(bucketFor90.scoreRangeMax).toBe(100);
    expect(bucketFor90.sampleCount).toBe(20);
    expect(bucketFor90.averagePredictedScore).toBeCloseTo(90);
  });
});

describe("calibrationReport — badly-calibrated (overconfident) dataset", () => {
  // Model predicts near-zero risk (score 100) for everything, but every
  // single one defaults. Maximally miscalibrated.
  const samples: CalibrationSample[] = repeatedSamples(100, 10, 10);

  it("reports a calibration gap of 1 (maximally miscalibrated)", () => {
    const report = calibrationReport(samples);
    expect(report.meanAbsoluteCalibrationGap).toBeCloseTo(1);
  });

  it("reports the worst possible Brier score of 1", () => {
    const report = calibrationReport(samples);
    expect(report.brierScore).toBeCloseTo(1);
  });

  it("shows overallPredictedDefaultRate near 0 but overallActualDefaultRate at 1", () => {
    const report = calibrationReport(samples);
    expect(report.overallPredictedDefaultRate).toBeCloseTo(0);
    expect(report.overallActualDefaultRate).toBeCloseTo(1);
  });
});

describe("calibrationReport — bucket structure", () => {
  it("always returns bucketCount buckets covering the full 0-100 range, even when empty", () => {
    const report = calibrationReport([{ predictedScore: 5, actualOutcome: false }], {
      bucketCount: 10,
    });
    expect(report.buckets.length).toBe(10);
    expect(report.buckets[0]!.scoreRangeMin).toBe(0);
    expect(report.buckets[9]!.scoreRangeMax).toBe(100);

    const emptyBucket = report.buckets.find((b) => b.bucketIndex === 5)!;
    expect(emptyBucket.sampleCount).toBe(0);
    expect(Number.isNaN(emptyBucket.averagePredictedScore)).toBe(true);
    expect(Number.isNaN(emptyBucket.actualDefaultRate)).toBe(true);
  });

  it("supports a custom bucketCount", () => {
    const samples: CalibrationSample[] = [
      { predictedScore: 10, actualOutcome: true },
      { predictedScore: 90, actualOutcome: false },
    ];
    const report = calibrationReport(samples, { bucketCount: 4 });
    expect(report.buckets.length).toBe(4);
    expect(report.buckets.map((b) => b.scoreRangeMax)).toEqual([25, 50, 75, 100]);
  });

  it("assigns a perfect score of 100 to the top (last) bucket", () => {
    const report = calibrationReport([{ predictedScore: 100, actualOutcome: false }]);
    const lastBucket = report.buckets[report.buckets.length - 1]!;
    expect(lastBucket.sampleCount).toBe(1);
  });

  it("assigns a score of 0 to the bottom (first) bucket", () => {
    const report = calibrationReport([{ predictedScore: 0, actualOutcome: true }]);
    expect(report.buckets[0]!.sampleCount).toBe(1);
  });
});
