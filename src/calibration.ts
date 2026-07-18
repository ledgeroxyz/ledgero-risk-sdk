/**
 * Calibration / backtesting utility.
 *
 * A standalone statistical tool for checking whether a risk model's
 * scores actually track real-world outcomes: given a set of historical
 * `{ predictedScore, actualOutcome }` pairs (e.g. "we scored this asset
 * 72 at underwriting time, and it did/didn't default"), compute a
 * calibration report — a bucketed predicted-vs-actual default rate
 * table, a Brier score, and a simple reliability summary.
 *
 * This module has no dependency on `RiskModel`/`scoreAsset` — it only
 * needs the final 0-100 scores and known outcomes, so it works equally
 * well against scores produced by this SDK, a legacy model, or a
 * third-party system.
 */

import { RiskModelError } from "./types.js";

/**
 * One historical observation: a risk score produced at some point in the
 * past, paired with the outcome that was later observed.
 */
export interface CalibrationSample {
  /**
   * The score that was predicted at the time, 0-100, following this
   * SDK's convention where 100 = lowest risk / best outcome (same scale
   * as `ScoreResult.overallScore`).
   */
  predictedScore: number;
  /**
   * Whether the adverse outcome the model is trying to predict actually
   * occurred (e.g. the asset defaulted, the invoice went unpaid).
   */
  actualOutcome: boolean;
}

export interface CalibrationOptions {
  /**
   * Number of equal-width buckets to divide the 0-100 score range into.
   * Defaults to `10` (i.e. decile buckets: 0-10, 10-20, ..., 90-100).
   */
  bucketCount?: number;
}

/** Predicted-vs-actual default rate for one score bucket. */
export interface CalibrationBucket {
  bucketIndex: number;
  /** Inclusive lower bound of this bucket's score range. */
  scoreRangeMin: number;
  /** Exclusive upper bound of this bucket's score range (the last bucket's upper bound is inclusive). */
  scoreRangeMax: number;
  /** Number of samples whose `predictedScore` fell into this bucket. */
  sampleCount: number;
  /** Mean `predictedScore` of samples in this bucket (`NaN` when empty). */
  averagePredictedScore: number;
  /**
   * Mean predicted probability of the adverse outcome within this
   * bucket, i.e. the average of `(100 - predictedScore) / 100` (`NaN`
   * when empty).
   */
  predictedDefaultRate: number;
  /** Fraction of samples in this bucket where `actualOutcome` was `true` (`NaN` when empty). */
  actualDefaultRate: number;
  /**
   * `actualDefaultRate - predictedDefaultRate`. Positive means the
   * model was too optimistic in this bucket (actual risk exceeded
   * predicted risk); negative means it was too pessimistic. `NaN` when
   * empty.
   */
  calibrationGap: number;
}

/** Full calibration report for a set of historical predicted/actual pairs. */
export interface CalibrationReport {
  sampleCount: number;
  /**
   * Brier score: mean squared error between each sample's predicted
   * default probability and its actual outcome (0 or 1). Ranges 0
   * (perfect) to 1 (worst possible), with 0.25 being the score of an
   * uninformative constant 50% predictor against a balanced dataset.
   */
  brierScore: number;
  /** Per-bucket breakdown, ordered from lowest to highest score range. */
  buckets: CalibrationBucket[];
  /**
   * Sample-weighted mean absolute calibration gap across non-empty
   * buckets — a single-number summary of how far off, on average, the
   * model's implied default rate is from the observed default rate.
   * Lower is better; `0` is perfect calibration.
   */
  meanAbsoluteCalibrationGap: number;
  /** Mean predicted default probability across all samples. */
  overallPredictedDefaultRate: number;
  /** Fraction of all samples where `actualOutcome` was `true`. */
  overallActualDefaultRate: number;
}

function predictedDefaultProbability(predictedScore: number): number {
  return (100 - predictedScore) / 100;
}

/**
 * Compute a calibration report from historical predicted-score /
 * actual-outcome pairs: a bucketed predicted-vs-actual default rate
 * table, the Brier score, and a sample-weighted mean calibration gap.
 *
 * Buckets always cover the full 0-100 range (even if empty), so the
 * report reflects the complete score distribution the model is expected
 * to produce, not just the ranges seen in this particular dataset.
 */
export function calibrationReport(
  samples: CalibrationSample[],
  options: CalibrationOptions = {},
): CalibrationReport {
  if (samples.length === 0) {
    throw new RiskModelError("calibrationReport: `samples` must not be empty.");
  }

  const bucketCount = options.bucketCount ?? 10;
  if (!Number.isInteger(bucketCount) || bucketCount < 1) {
    throw new RiskModelError("calibrationReport: `bucketCount` must be a positive integer.");
  }

  for (const sample of samples) {
    if (!Number.isFinite(sample.predictedScore) || sample.predictedScore < 0 || sample.predictedScore > 100) {
      throw new RiskModelError(
        `calibrationReport: \`predictedScore\` must be a finite number in [0, 100] (got ${sample.predictedScore}).`,
      );
    }
  }

  const bucketWidth = 100 / bucketCount;
  const buckets: Array<{ scores: number[]; outcomes: boolean[] }> = Array.from(
    { length: bucketCount },
    () => ({ scores: [], outcomes: [] }),
  );

  for (const sample of samples) {
    const index = Math.min(bucketCount - 1, Math.floor(sample.predictedScore / bucketWidth));
    buckets[index]!.scores.push(sample.predictedScore);
    buckets[index]!.outcomes.push(sample.actualOutcome);
  }

  const bucketResults: CalibrationBucket[] = buckets.map((bucket, index) => {
    const sampleCount = bucket.scores.length;
    const scoreRangeMin = index * bucketWidth;
    const scoreRangeMax = (index + 1) * bucketWidth;

    if (sampleCount === 0) {
      return {
        bucketIndex: index,
        scoreRangeMin,
        scoreRangeMax,
        sampleCount: 0,
        averagePredictedScore: Number.NaN,
        predictedDefaultRate: Number.NaN,
        actualDefaultRate: Number.NaN,
        calibrationGap: Number.NaN,
      };
    }

    const averagePredictedScore = bucket.scores.reduce((s, v) => s + v, 0) / sampleCount;
    const predictedDefaultRate =
      bucket.scores.reduce((s, v) => s + predictedDefaultProbability(v), 0) / sampleCount;
    const actualDefaultRate =
      bucket.outcomes.filter((outcome) => outcome).length / sampleCount;

    return {
      bucketIndex: index,
      scoreRangeMin,
      scoreRangeMax,
      sampleCount,
      averagePredictedScore,
      predictedDefaultRate,
      actualDefaultRate,
      calibrationGap: actualDefaultRate - predictedDefaultRate,
    };
  });

  const brierScore =
    samples.reduce((sum, sample) => {
      const predicted = predictedDefaultProbability(sample.predictedScore);
      const actual = sample.actualOutcome ? 1 : 0;
      return sum + (predicted - actual) ** 2;
    }, 0) / samples.length;

  const nonEmptyBuckets = bucketResults.filter((b) => b.sampleCount > 0);
  const meanAbsoluteCalibrationGap =
    nonEmptyBuckets.reduce((sum, b) => sum + Math.abs(b.calibrationGap) * b.sampleCount, 0) /
    samples.length;

  const overallPredictedDefaultRate =
    samples.reduce((sum, s) => sum + predictedDefaultProbability(s.predictedScore), 0) /
    samples.length;
  const overallActualDefaultRate =
    samples.filter((s) => s.actualOutcome).length / samples.length;

  return {
    sampleCount: samples.length,
    brierScore,
    buckets: bucketResults,
    meanAbsoluteCalibrationGap,
    overallPredictedDefaultRate,
    overallActualDefaultRate,
  };
}
