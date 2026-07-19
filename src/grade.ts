/**
 * Letter-grade mapping.
 *
 * The LEDGERO dapp presents underwriting results as a single letter
 * rating (A/B/C/D) rather than the SDK's four-tier `low/medium/high/
 * critical` ladder. This module bridges the two so SDK output renders in
 * the dapp with no reshaping: `toLetterGrade` maps a 0-100 score using
 * the dapp's exact thresholds, and `tierToLetterGrade` maps the SDK's
 * `RiskTier` onto the same scale.
 */

import type { LetterGrade, RiskTier } from "./types.js";

export type { LetterGrade } from "./types.js";

/**
 * Map a 0-100 overall score to the LEDGERO dapp's letter grade using the
 * dapp's exact thresholds: `A` if score >= 80, `B` if >= 60, `C` if >= 40,
 * otherwise `D`. Non-finite input is treated as the worst grade (`D`).
 *
 * Higher scores mean lower risk (SDK convention), so `A` is the best
 * grade — consistent with the dapp's `rating` field.
 */
export function toLetterGrade(score: number): LetterGrade {
  if (!Number.isFinite(score)) return "D";
  if (score >= 80) return "A";
  if (score >= 60) return "B";
  if (score >= 40) return "C";
  return "D";
}

/**
 * Map an SDK `RiskTier` onto the dapp's letter grade. The two ladders
 * share the same score thresholds (80/60/40), so the mapping is a direct
 * one-to-one: low->A, medium->B, high->C, critical->D.
 */
export function tierToLetterGrade(tier: RiskTier): LetterGrade {
  switch (tier) {
    case "low":
      return "A";
    case "medium":
      return "B";
    case "high":
      return "C";
    case "critical":
      return "D";
  }
}
