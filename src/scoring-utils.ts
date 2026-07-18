/**
 * Small, pure, composable helpers for writing `RiskFactor.score`
 * functions. None of these depend on the engine — they just map raw
 * input values onto the 0-100 sub-score scale.
 */

import { RiskModelError } from "./types.js";

/** Clamp a number into [0, 100]. Non-finite input clamps to 0. */
export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export interface LinearScoreOptions {
  /** Raw value at (or below) which the score is 0 (or 100 when `invert`). */
  min: number;
  /** Raw value at (or above) which the score is 100 (or 0 when `invert`). */
  max: number;
  /**
   * When true, higher raw values produce *lower* scores (e.g. a
   * delinquency rate where more delinquency is worse).
   */
  invert?: boolean;
}

/**
 * Linearly interpolate `value` between `min` and `max` onto a 0-100
 * score. Values outside [min, max] are clamped before interpolation, so
 * the result is always in [0, 100].
 */
export function linearScore(
  value: number,
  { min, max, invert = false }: LinearScoreOptions,
): number {
  if (min === max) {
    throw new RiskModelError("linearScore: `min` and `max` must differ");
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new RiskModelError("linearScore: `min` and `max` must be finite");
  }

  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const clampedValue = Math.min(hi, Math.max(lo, value));
  const ratio = (clampedValue - min) / (max - min);
  const score = invert ? (1 - ratio) * 100 : ratio * 100;
  return clampScore(score);
}

/** Shorthand for `linearScore(value, { ...options, invert: true })`. */
export function inverseLinearScore(
  value: number,
  options: Omit<LinearScoreOptions, "invert">,
): number {
  return linearScore(value, { ...options, invert: true });
}

export interface ScoreStep {
  /** Upper (inclusive) bound of the raw value for this band. */
  threshold: number;
  /** Score awarded when the raw value falls in this band. */
  score: number;
}

/**
 * Piecewise / stepwise scoring: given bands sorted by ascending
 * `threshold`, returns the `score` of the first band whose `threshold`
 * is `>= value`. If `value` exceeds every threshold, the last band's
 * score is returned. Useful for discrete risk bands (e.g. "days past
 * due" or "asset age") that don't map cleanly to a straight line.
 *
 * Bands do not need to be pre-sorted — `stepScore` sorts a copy by
 * `threshold` before evaluating.
 */
export function stepScore(value: number, steps: ScoreStep[]): number {
  if (steps.length === 0) {
    throw new RiskModelError("stepScore: `steps` must not be empty");
  }
  const sorted = [...steps].sort((a, b) => a.threshold - b.threshold);
  for (const step of sorted) {
    if (value <= step.threshold) {
      return clampScore(step.score);
    }
  }
  const lastStep = sorted[sorted.length - 1];
  return clampScore(lastStep!.score);
}

export interface BoolScoreOptions {
  /** Score awarded when the condition is true. */
  trueScore: number;
  /** Score awarded when the condition is false. */
  falseScore: number;
}

/** Map a boolean condition (e.g. "has title defects") to a 0-100 score. */
export function boolScore(
  value: boolean,
  { trueScore, falseScore }: BoolScoreOptions,
): number {
  return clampScore(value ? trueScore : falseScore);
}
