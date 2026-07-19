/**
 * LEDGERO dapp adapter.
 *
 * The dapp renders each risk factor as a `{ label, impact, detail }`
 * object, where `impact` is a qualitative `"positive" | "negative" |
 * "neutral"` cue rather than a number. The SDK produces a richer,
 * weighted `FactorContribution[]` breakdown. This module is the concrete
 * bridge: `toDappRiskFactors` converts the SDK's explainable breakdown
 * into exactly the dapp's `RiskFactor` shape, so the dapp can persist and
 * render SDK output with zero reshaping.
 */

import type { FactorContribution, ScoreResult } from "./types.js";

/**
 * The dapp's factor shape (mirrors the dapp's `RiskFactor` interface in
 * `underwriting-types.ts`). Reproduced here so the SDK has no dependency
 * on the dapp; the field names and the `impact` union match exactly.
 */
export interface DappRiskFactor {
  label: string;
  impact: "positive" | "negative" | "neutral";
  detail: string;
}

/**
 * Options controlling how a factor's 0-100 sub-score maps onto the dapp's
 * qualitative `impact`. Scores strictly above `neutralHigh` are
 * `positive`, strictly below `neutralLow` are `negative`, and anything in
 * the `[neutralLow, neutralHigh]` band (inclusive) is `neutral`.
 *
 * Defaults define a symmetric neutral band around the 50 midpoint so a
 * factor that lands mid-scale reads as genuinely neutral rather than
 * being forced positive or negative.
 */
export interface DappAdapterOptions {
  /** Sub-scores at or below this read as `negative`. Default 45. */
  neutralLow?: number;
  /** Sub-scores at or above this read as `positive`. Default 55. */
  neutralHigh?: number;
}

const DEFAULT_NEUTRAL_LOW = 45;
const DEFAULT_NEUTRAL_HIGH = 55;

function impactFor(
  subScore: number,
  neutralLow: number,
  neutralHigh: number,
): DappRiskFactor["impact"] {
  if (subScore > neutralHigh) return "positive";
  if (subScore < neutralLow) return "negative";
  return "neutral";
}

function detailFor(factor: FactorContribution, impact: DappRiskFactor["impact"]): string {
  const scored = Math.round(factor.subScore);
  const weightPct = Math.round(factor.normalizedWeight * 100);
  const verb =
    impact === "positive"
      ? "supports the asset"
      : impact === "negative"
        ? "weighs against the asset"
        : "is neutral for the asset";
  return `${factor.label} scored ${scored}/100 (${weightPct}% of the overall weight) — ${verb}.`;
}

/**
 * Convert a single SDK `FactorContribution` into the dapp's
 * `{ label, impact, detail }` shape.
 */
export function toDappRiskFactor(
  factor: FactorContribution,
  options: DappAdapterOptions = {},
): DappRiskFactor {
  const neutralLow = options.neutralLow ?? DEFAULT_NEUTRAL_LOW;
  const neutralHigh = options.neutralHigh ?? DEFAULT_NEUTRAL_HIGH;
  const impact = impactFor(factor.subScore, neutralLow, neutralHigh);
  return {
    label: factor.label,
    impact,
    detail: detailFor(factor, impact),
  };
}

/**
 * Convert an SDK `ScoreResult`'s explainable per-factor breakdown into
 * the dapp's `RiskFactor[]` shape. This is the concrete bridge that lets
 * the dapp render SDK output directly — the returned array can be stored
 * in the dapp's `factorsJson` column and read back with no transform.
 *
 * `impact` is derived from each factor's own 0-100 sub-score relative to
 * a neutral midpoint band (see {@link DappAdapterOptions}); `label` comes
 * from the factor's `label`; `detail` is a human-readable sentence
 * summarizing the sub-score and the factor's share of the overall weight.
 */
export function toDappRiskFactors(
  result: ScoreResult,
  options: DappAdapterOptions = {},
): DappRiskFactor[] {
  return result.breakdown.map((factor) => toDappRiskFactor(factor, options));
}
