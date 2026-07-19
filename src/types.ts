/**
 * Core public types for @ledgeroxyz/risk-sdk.
 *
 * Scoring convention: every sub-score and the overall score live on a
 * 0-100 scale where 100 means "best / lowest risk" and 0 means
 * "worst / highest risk". Risk tiers are derived from the overall score
 * via configurable thresholds (see `tiers.ts`).
 */

/**
 * Supported real-world-asset classes. Extend this union (and provide a
 * matching `RiskModel<TFacts>`) to support additional asset classes —
 * the engine itself is not hardcoded to these classes.
 *
 * This vocabulary is a superset of the LEDGERO dapp's asset classes
 * (`invoice`, `receivable`, `real_estate`, `inventory`, `other`) so the
 * dapp can adopt the SDK directly. `property` is kept as an alias for the
 * dapp-aligned `real_estate` name — both resolve to the same default model.
 */
export type AssetClass =
  | "invoice"
  | "receivable"
  | "property"
  | "real_estate"
  | "inventory"
  | "trade-finance"
  | "equipment-lease"
  | "other";

/**
 * Qualitative risk bucket derived from the overall 0-100 score.
 */
export type RiskTier = "low" | "medium" | "high" | "critical";

/**
 * A single boundary in a tier ladder: any overall score `>= minScore`
 * (and below the next-higher threshold's `minScore`) is classified as
 * `tier`.
 */
export interface RiskTierThreshold {
  tier: RiskTier;
  minScore: number;
}

/**
 * One named, weighted, independently-scorable dimension of risk.
 *
 * `score` receives the structured facts about the asset and must return
 * a number where 100 is the best possible outcome for that dimension and
 * 0 is the worst. Values outside [0, 100] are clamped by the engine, and
 * non-finite results (NaN/Infinity) cause a `RiskModelError`.
 */
export interface RiskFactor<TFacts = unknown> {
  /** Stable machine-readable identifier, unique within a `RiskModel`. */
  id: string;
  /** Short human-readable name, suitable for UI / reports. */
  label: string;
  /** Longer explanation of what this factor measures and why it matters. */
  description?: string;
  /**
   * Relative weight of this factor within its model. Weights do not need
   * to sum to any particular total — the engine normalizes them across
   * all factors in the model. Must be a finite number >= 0.
   */
  weight: number;
  /** Pure function mapping asset facts to a 0-100 sub-score. */
  score: (facts: TFacts) => number;
}

/**
 * A configurable, named collection of risk factors for one asset class,
 * plus optional custom tier thresholds. This is the unit of
 * configuration callers create, override, or replace entirely.
 */
export interface RiskModel<TFacts = unknown> {
  assetClass: AssetClass;
  /** Optional human-readable name for this model / configuration. */
  name?: string;
  description?: string;
  factors: RiskFactor<TFacts>[];
  /**
   * Tier boundaries used to classify the overall score. Defaults to
   * `defaultTierThresholds` from `tiers.ts` when omitted.
   */
  tierThresholds?: RiskTierThreshold[];
}

/**
 * The contribution of a single factor to an overall score, returned as
 * part of the explainable breakdown.
 */
export interface FactorContribution {
  id: string;
  label: string;
  /** The factor's raw configured weight. */
  weight: number;
  /** `weight` divided by the sum of all factor weights in the model. */
  normalizedWeight: number;
  /** The factor's own 0-100 sub-score (post-clamping). */
  subScore: number;
  /** `subScore * normalizedWeight` — this factor's share of the overall score. */
  contribution: number;
}

/**
 * Full, explainable result of scoring a single asset against a
 * `RiskModel`.
 */
export interface ScoreResult {
  assetClass: AssetClass;
  /** Weighted overall score, 0-100, where 100 is lowest risk. */
  overallScore: number;
  /** Risk tier derived from `overallScore` via the model's tier thresholds. */
  tier: RiskTier;
  /** Per-factor breakdown explaining how `overallScore` was derived. */
  breakdown: FactorContribution[];
}

/**
 * Thrown when a `RiskModel` is misconfigured (no factors, duplicate
 * factor ids, invalid weights) or a factor's scoring function returns a
 * non-finite value.
 */
export class RiskModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiskModelError";
  }
}
