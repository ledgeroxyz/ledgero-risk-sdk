import {
  RiskModelError,
  type FactorContribution,
  type RiskFactor,
  type RiskModel,
  type ScoreResult,
} from "./types.js";
import { defaultTierThresholds, resolveTier } from "./tiers.js";
import { toLetterGrade } from "./grade.js";

function clamp0to100(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function validateModel<TFacts>(model: RiskModel<TFacts>): void {
  if (!model.factors || model.factors.length === 0) {
    throw new RiskModelError(
      `Risk model "${model.assetClass}" must define at least one risk factor.`,
    );
  }

  const seenIds = new Set<string>();
  for (const factor of model.factors) {
    if (!factor.id) {
      throw new RiskModelError("Every risk factor must have a non-empty `id`.");
    }
    if (seenIds.has(factor.id)) {
      throw new RiskModelError(
        `Duplicate risk factor id "${factor.id}" in model "${model.assetClass}".`,
      );
    }
    seenIds.add(factor.id);

    if (!Number.isFinite(factor.weight) || factor.weight < 0) {
      throw new RiskModelError(
        `Risk factor "${factor.id}" has an invalid weight (must be a finite number >= 0).`,
      );
    }
  }
}

/**
 * Score a single asset's facts against a `RiskModel`, producing a
 * weighted overall score, a risk tier, and a full explainable breakdown.
 *
 * This is the core, stateless scoring function. `createRiskEngine` is a
 * thin convenience wrapper around it for callers who want to bind a
 * model once and reuse it.
 */
export function scoreAsset<TFacts>(
  model: RiskModel<TFacts>,
  facts: TFacts,
): ScoreResult {
  validateModel(model);

  const totalWeight = model.factors.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight <= 0) {
    throw new RiskModelError(
      `Risk model "${model.assetClass}" has no positive total weight across its factors.`,
    );
  }

  const breakdown: FactorContribution[] = model.factors.map((factor: RiskFactor<TFacts>) => {
    const rawScore = factor.score(facts);
    if (!Number.isFinite(rawScore)) {
      throw new RiskModelError(
        `Factor "${factor.id}" in model "${model.assetClass}" produced a non-finite sub-score.`,
      );
    }

    const subScore = clamp0to100(rawScore);
    const normalizedWeight = factor.weight / totalWeight;

    return {
      id: factor.id,
      label: factor.label,
      weight: factor.weight,
      normalizedWeight,
      subScore,
      contribution: subScore * normalizedWeight,
    };
  });

  const overallScore = clamp0to100(
    breakdown.reduce((sum, contribution) => sum + contribution.contribution, 0),
  );
  const tier = resolveTier(overallScore, model.tierThresholds ?? defaultTierThresholds);

  return {
    assetClass: model.assetClass,
    overallScore,
    tier,
    letterGrade: toLetterGrade(overallScore),
    breakdown,
  };
}

/**
 * A `RiskModel` bound to a reusable scoring function. Prefer this when
 * you're scoring many assets of the same class against the same model.
 */
export interface RiskEngine<TFacts> {
  readonly model: RiskModel<TFacts>;
  score(facts: TFacts): ScoreResult;
}

/**
 * Create a reusable `RiskEngine` bound to `model`. The model is
 * validated eagerly so misconfiguration is caught at construction time
 * rather than on the first `score()` call.
 */
export function createRiskEngine<TFacts>(model: RiskModel<TFacts>): RiskEngine<TFacts> {
  validateModel(model);
  return {
    model,
    score(facts: TFacts): ScoreResult {
      return scoreAsset(model, facts);
    },
  };
}

/**
 * Patch describing how to derive a new `RiskModel` from an existing one
 * (typically one of the built-in defaults). Lets callers tweak a couple
 * of weights or thresholds without redeclaring every factor.
 */
export interface RiskModelOverrides<TFacts> {
  name?: string;
  description?: string;
  /**
   * Partial overrides applied to existing factors, matched by `id`.
   * Any field present (e.g. `weight`, `score`, `label`) replaces the
   * base factor's field; omitted fields are kept as-is.
   */
  factors?: Array<Partial<RiskFactor<TFacts>> & { id: string }>;
  /** New factors appended to the model. */
  addFactors?: RiskFactor<TFacts>[];
  /** Ids of existing factors to drop entirely. */
  removeFactorIds?: string[];
  tierThresholds?: RiskModel<TFacts>["tierThresholds"];
}

/**
 * Derive a new `RiskModel` from `base` by applying `overrides`. `base`
 * is never mutated. Useful for adapting a default model (e.g.
 * `invoiceRiskModel`) to a caller's own underwriting policy while
 * reusing everything that doesn't need to change.
 */
export function mergeRiskModel<TFacts>(
  base: RiskModel<TFacts>,
  overrides: RiskModelOverrides<TFacts>,
): RiskModel<TFacts> {
  let factors = base.factors.map((factor) => {
    const override = overrides.factors?.find((candidate) => candidate.id === factor.id);
    return override ? { ...factor, ...override } : factor;
  });

  if (overrides.removeFactorIds && overrides.removeFactorIds.length > 0) {
    const removeSet = new Set(overrides.removeFactorIds);
    factors = factors.filter((factor) => !removeSet.has(factor.id));
  }

  if (overrides.addFactors && overrides.addFactors.length > 0) {
    factors = [...factors, ...overrides.addFactors];
  }

  return {
    ...base,
    name: overrides.name ?? base.name,
    description: overrides.description ?? base.description,
    factors,
    tierThresholds: overrides.tierThresholds ?? base.tierThresholds,
  };
}
