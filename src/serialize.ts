/**
 * Model versioning & serialization.
 *
 * `RiskModel.factors[].score` is a plain JS function, so an arbitrary
 * `RiskModel` cannot round-trip through `JSON.stringify` — closures don't
 * survive serialization. To make models portable (store them in a
 * database, ship them over the wire, diff two policy versions, etc.),
 * this module introduces a parallel **declarative** factor
 * representation, `SerializableRiskFactor`, that describes a factor's
 * scoring logic as data instead of code — built entirely out of the same
 * primitives `scoring-utils.ts` already exposes (`linearScore` /
 * `inverseLinearScore` as `{ type: "linear", invert }`, `stepScore` as
 * `{ type: "step" }`, `boolScore` as `{ type: "bool" }`, plus a `"clamp"`
 * pass-through for the "just clamp this field to 0-100" case used by the
 * default jurisdiction-risk factors).
 *
 * A `SerializableRiskModel` built this way is plain JSON-safe data. Use
 * `hydrateRiskModel` to turn it into a real, usable `RiskModel` (with
 * live `score` closures reconstructed from the spec) for `scoreAsset` /
 * `createRiskEngine`.
 *
 * **Limitation:** this only covers factors expressible via the
 * `scoring-utils` primitives. A `RiskFactor` whose `score` is a fully
 * custom closure (arbitrary JS logic, multi-field combinations, closures
 * over outside state, etc.) is *not* representable as a
 * `SerializableRiskFactor` and cannot be round-tripped by this module —
 * such models must stay in plain in-memory `RiskModel` form, or be
 * refactored to use `mergeRiskModel`/custom `field`+`scoring` pairs where
 * possible.
 *
 * **JSON caveat:** every number in a `SerializableRiskModel` must be
 * finite — `JSON.stringify` silently turns `Infinity`/`-Infinity`/`NaN`
 * into `null`, which would corrupt the round trip. Where the in-memory
 * default models use `Number.POSITIVE_INFINITY` as an open-ended top
 * `stepScore` band, use a large finite sentinel instead (e.g.
 * `Number.MAX_SAFE_INTEGER`). `validateSerializableModel` rejects
 * non-finite numbers up front so this fails fast rather than silently.
 */

import { RiskModelError, type AssetClass, type RiskModel, type RiskTierThreshold } from "./types.js";
import { boolScore, clampScore, linearScore, stepScore, type ScoreStep } from "./scoring-utils.js";

/**
 * Data-only description of how to turn one field's raw value into a
 * 0-100 sub-score, mirroring the `scoring-utils.ts` primitives.
 */
export type SerializableScoringSpec =
  | { type: "linear"; min: number; max: number; invert?: boolean }
  | { type: "step"; steps: ScoreStep[] }
  | { type: "bool"; trueScore: number; falseScore: number }
  | { type: "clamp" };

/**
 * JSON-safe, declarative equivalent of `RiskFactor<TFacts>`: instead of a
 * `score` function, it names the single `field` of `TFacts` to read and a
 * `scoring` spec describing how to convert that field's value into a
 * 0-100 sub-score.
 */
export interface SerializableRiskFactor<TFacts = Record<string, unknown>> {
  id: string;
  label: string;
  description?: string;
  weight: number;
  /** The property of `TFacts` this factor reads its raw value from. */
  field: Extract<keyof TFacts, string>;
  scoring: SerializableScoringSpec;
}

/**
 * JSON-safe, declarative equivalent of `RiskModel<TFacts>`, plus an
 * explicit `version` so callers can track and diff policy revisions over
 * time.
 */
export interface SerializableRiskModel<TFacts = Record<string, unknown>> {
  /** Semantic version of this model/policy, e.g. `"1.0.0"`. */
  version: string;
  assetClass: AssetClass;
  name?: string;
  description?: string;
  factors: SerializableRiskFactor<TFacts>[];
  tierThresholds?: RiskTierThreshold[];
}

function readField(facts: unknown, field: string): unknown {
  return (facts as Record<string, unknown>)[field];
}

function buildScoreFn<TFacts>(
  factor: SerializableRiskFactor<TFacts>,
): (facts: TFacts) => number {
  const { scoring, field } = factor;
  switch (scoring.type) {
    case "linear":
      return (facts) =>
        linearScore(Number(readField(facts, field)), {
          min: scoring.min,
          max: scoring.max,
          invert: scoring.invert,
        });
    case "step":
      return (facts) => stepScore(Number(readField(facts, field)), scoring.steps);
    case "bool":
      return (facts) =>
        boolScore(Boolean(readField(facts, field)), {
          trueScore: scoring.trueScore,
          falseScore: scoring.falseScore,
        });
    case "clamp":
      return (facts) => clampScore(Number(readField(facts, field)));
    default: {
      const exhaustive: never = scoring;
      throw new RiskModelError(
        `Unknown scoring spec type: ${JSON.stringify(exhaustive as unknown)}`,
      );
    }
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertFiniteNumber(value: unknown, message: string): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RiskModelError(message);
  }
}

function validateScoringSpec(scoring: unknown, factorId: string): asserts scoring is SerializableScoringSpec {
  if (!isPlainObject(scoring) || typeof scoring.type !== "string") {
    throw new RiskModelError(`Factor "${factorId}" has an invalid \`scoring\` spec.`);
  }
  switch (scoring.type) {
    case "linear":
      assertFiniteNumber(scoring.min, `Factor "${factorId}": linear scoring requires a finite \`min\`.`);
      assertFiniteNumber(scoring.max, `Factor "${factorId}": linear scoring requires a finite \`max\`.`);
      if (scoring.invert !== undefined && typeof scoring.invert !== "boolean") {
        throw new RiskModelError(`Factor "${factorId}": linear scoring's \`invert\` must be a boolean.`);
      }
      return;
    case "step":
      if (!Array.isArray(scoring.steps) || scoring.steps.length === 0) {
        throw new RiskModelError(`Factor "${factorId}": step scoring requires a non-empty \`steps\` array.`);
      }
      for (const step of scoring.steps) {
        if (!isPlainObject(step)) {
          throw new RiskModelError(
            `Factor "${factorId}": every step must have a numeric \`threshold\` and \`score\`.`,
          );
        }
        assertFiniteNumber(
          step.threshold,
          `Factor "${factorId}": every step's \`threshold\` must be a finite number. ` +
            "JSON has no representation for Infinity — use a large finite sentinel " +
            "(e.g. Number.MAX_SAFE_INTEGER) for an open-ended top band instead.",
        );
        assertFiniteNumber(
          step.score,
          `Factor "${factorId}": every step's \`score\` must be a finite number.`,
        );
      }
      return;
    case "bool":
      assertFiniteNumber(
        scoring.trueScore,
        `Factor "${factorId}": bool scoring requires a finite \`trueScore\`.`,
      );
      assertFiniteNumber(
        scoring.falseScore,
        `Factor "${factorId}": bool scoring requires a finite \`falseScore\`.`,
      );
      return;
    case "clamp":
      return;
    default:
      throw new RiskModelError(
        `Factor "${factorId}" has an unrecognized scoring type "${String((scoring as { type?: unknown }).type)}".`,
      );
  }
}

/**
 * Validate the shape of a `SerializableRiskModel`, throwing
 * `RiskModelError` with a descriptive message on the first problem found.
 * Used internally by `serializeRiskModel`, `deserializeRiskModel`, and
 * `hydrateRiskModel`, but exported for callers who want to validate a
 * model (e.g. one loaded from a database) before doing anything else
 * with it.
 */
export function validateSerializableModel<TFacts>(
  model: SerializableRiskModel<TFacts>,
): void {
  if (!isPlainObject(model)) {
    throw new RiskModelError("SerializableRiskModel must be a plain object.");
  }
  if (typeof model.version !== "string" || model.version.length === 0) {
    throw new RiskModelError("SerializableRiskModel must have a non-empty string `version`.");
  }
  if (typeof model.assetClass !== "string" || model.assetClass.length === 0) {
    throw new RiskModelError("SerializableRiskModel must have a non-empty `assetClass`.");
  }
  if (!Array.isArray(model.factors) || model.factors.length === 0) {
    throw new RiskModelError(
      `SerializableRiskModel "${model.assetClass}" must define at least one factor.`,
    );
  }

  const seenIds = new Set<string>();
  for (const factor of model.factors) {
    if (!isPlainObject(factor) || typeof factor.id !== "string" || factor.id.length === 0) {
      throw new RiskModelError("Every factor must have a non-empty `id`.");
    }
    if (seenIds.has(factor.id)) {
      throw new RiskModelError(`Duplicate factor id "${factor.id}".`);
    }
    seenIds.add(factor.id);

    if (typeof factor.label !== "string" || factor.label.length === 0) {
      throw new RiskModelError(`Factor "${factor.id}" must have a non-empty \`label\`.`);
    }
    if (typeof factor.weight !== "number" || !Number.isFinite(factor.weight) || factor.weight < 0) {
      throw new RiskModelError(`Factor "${factor.id}" has an invalid weight (must be a finite number >= 0).`);
    }
    if (typeof factor.field !== "string" || factor.field.length === 0) {
      throw new RiskModelError(`Factor "${factor.id}" must have a non-empty \`field\`.`);
    }
    validateScoringSpec(factor.scoring, factor.id);
  }

  if (model.tierThresholds !== undefined) {
    if (!Array.isArray(model.tierThresholds) || model.tierThresholds.length === 0) {
      throw new RiskModelError("`tierThresholds`, when present, must be a non-empty array.");
    }
  }
}

/**
 * Turn a `SerializableRiskModel` into a real, usable `RiskModel<TFacts>`
 * by reconstructing each factor's `score` function from its declarative
 * `scoring` spec via the `scoring-utils` primitives.
 */
export function hydrateRiskModel<TFacts>(
  model: SerializableRiskModel<TFacts>,
): RiskModel<TFacts> {
  validateSerializableModel(model);
  return {
    assetClass: model.assetClass,
    name: model.name,
    description: model.description,
    tierThresholds: model.tierThresholds,
    factors: model.factors.map((factor) => ({
      id: factor.id,
      label: factor.label,
      description: factor.description,
      weight: factor.weight,
      score: buildScoreFn(factor),
    })),
  };
}

/**
 * Serialize a `SerializableRiskModel` to a JSON string, validating its
 * shape first so malformed models fail fast rather than producing
 * corrupt output.
 */
export function serializeRiskModel<TFacts>(
  model: SerializableRiskModel<TFacts>,
  space: string | number = 2,
): string {
  validateSerializableModel(model);
  return JSON.stringify(model, null, space);
}

/**
 * Parse and validate a JSON string produced by `serializeRiskModel` (or
 * hand-authored) back into a `SerializableRiskModel`. Throws
 * `RiskModelError` on invalid JSON or a malformed model shape. Combine
 * with `hydrateRiskModel` to get back a live, scorable `RiskModel`.
 */
export function deserializeRiskModel<TFacts = Record<string, unknown>>(
  json: string,
): SerializableRiskModel<TFacts> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new RiskModelError(
      `deserializeRiskModel: invalid JSON (${(err as Error).message}).`,
    );
  }
  const model = parsed as SerializableRiskModel<TFacts>;
  validateSerializableModel(model);
  return model;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((key) => deepEqual(a[key], b[key]));
  }
  return false;
}

/** A factor's weight changed between two model versions. */
export interface FactorWeightChange {
  id: string;
  fromWeight: number;
  toWeight: number;
}

/** A factor's source `field` changed between two model versions. */
export interface FactorFieldChange {
  id: string;
  fromField: string;
  toField: string;
}

/** A factor's `scoring` spec changed (in any way) between two model versions. */
export interface FactorScoringChange {
  id: string;
  from: SerializableScoringSpec;
  to: SerializableScoringSpec;
}

/** Structured diff between two versions of a `SerializableRiskModel`. */
export interface RiskModelDiff {
  fromVersion: string;
  toVersion: string;
  versionChanged: boolean;
  /** Factor ids present in `to` but not `from`. */
  addedFactorIds: string[];
  /** Factor ids present in `from` but not `to`. */
  removedFactorIds: string[];
  /** Factors present in both, with a changed `weight`. */
  weightChanges: FactorWeightChange[];
  /** Factors present in both, with a changed `field`. */
  fieldChanges: FactorFieldChange[];
  /** Factors present in both, with a changed `scoring` spec. */
  scoringChanges: FactorScoringChange[];
  /** Whether `tierThresholds` differs between the two models. */
  tierThresholdsChanged: boolean;
}

/**
 * Compare two versions of a `SerializableRiskModel` and report what
 * changed — added/removed factors, re-weighted factors, factors whose
 * source field or scoring logic changed, and whether tier thresholds
 * moved. Useful for reviewing/auditing underwriting policy changes over
 * time (e.g. before promoting a new model version to production).
 */
export function diffRiskModels<TFacts>(
  from: SerializableRiskModel<TFacts>,
  to: SerializableRiskModel<TFacts>,
): RiskModelDiff {
  validateSerializableModel(from);
  validateSerializableModel(to);

  const fromById = new Map(from.factors.map((f) => [f.id, f] as const));
  const toById = new Map(to.factors.map((f) => [f.id, f] as const));

  const addedFactorIds = [...toById.keys()].filter((id) => !fromById.has(id));
  const removedFactorIds = [...fromById.keys()].filter((id) => !toById.has(id));

  const weightChanges: FactorWeightChange[] = [];
  const fieldChanges: FactorFieldChange[] = [];
  const scoringChanges: FactorScoringChange[] = [];

  for (const [id, fromFactor] of fromById) {
    const toFactor = toById.get(id);
    if (!toFactor) continue;

    if (fromFactor.weight !== toFactor.weight) {
      weightChanges.push({ id, fromWeight: fromFactor.weight, toWeight: toFactor.weight });
    }
    if (fromFactor.field !== toFactor.field) {
      fieldChanges.push({ id, fromField: fromFactor.field, toField: toFactor.field });
    }
    if (!deepEqual(fromFactor.scoring, toFactor.scoring)) {
      scoringChanges.push({ id, from: fromFactor.scoring, to: toFactor.scoring });
    }
  }

  return {
    fromVersion: from.version,
    toVersion: to.version,
    versionChanged: from.version !== to.version,
    addedFactorIds,
    removedFactorIds,
    weightChanges,
    fieldChanges,
    scoringChanges,
    tierThresholdsChanged: !deepEqual(from.tierThresholds, to.tierThresholds),
  };
}
