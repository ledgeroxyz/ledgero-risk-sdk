import { describe, expect, it } from "vitest";
import {
  deserializeRiskModel,
  diffRiskModels,
  hydrateRiskModel,
  serializeRiskModel,
  validateSerializableModel,
  type SerializableRiskModel,
} from "../src/serialize.js";
import { RiskModelError } from "../src/types.js";
import { scoreAsset } from "../src/engine.js";

interface DemoFacts {
  onTimeRatio: number;
  daysPastDue: number;
  hasFlag: boolean;
  jurisdictionScore: number;
}

function makeModel(): SerializableRiskModel<DemoFacts> {
  return {
    version: "1.0.0",
    assetClass: "invoice",
    name: "Demo model",
    factors: [
      {
        id: "payment-history",
        label: "Payment history",
        weight: 40,
        field: "onTimeRatio",
        scoring: { type: "linear", min: 0, max: 1 },
      },
      {
        id: "delinquency",
        label: "Delinquency",
        weight: 30,
        field: "daysPastDue",
        scoring: {
          type: "step",
          // Note: JSON has no representation for Infinity (it serializes to
          // `null`), so serializable step specs must use a large finite
          // sentinel instead of `Number.POSITIVE_INFINITY` for an open-ended
          // top band.
          steps: [
            { threshold: 0, score: 100 },
            { threshold: 30, score: 50 },
            { threshold: Number.MAX_SAFE_INTEGER, score: 0 },
          ],
        },
      },
      {
        id: "flag",
        label: "Exclusion flag",
        weight: 10,
        field: "hasFlag",
        scoring: { type: "bool", trueScore: 0, falseScore: 100 },
      },
      {
        id: "jurisdiction-risk",
        label: "Jurisdiction risk",
        weight: 20,
        field: "jurisdictionScore",
        scoring: { type: "clamp" },
      },
    ],
  };
}

describe("serializeRiskModel / deserializeRiskModel — round trip", () => {
  it("round-trips a model through JSON", () => {
    const model = makeModel();
    const json = serializeRiskModel(model);
    const parsed = deserializeRiskModel<DemoFacts>(json);
    expect(parsed).toEqual(model);
  });

  it("produces valid JSON with no function values", () => {
    const json = serializeRiskModel(makeModel());
    expect(() => JSON.parse(json)).not.toThrow();
    expect(json).not.toMatch(/function|=>/);
  });

  it("throws on invalid JSON", () => {
    expect(() => deserializeRiskModel("{not json")).toThrow(RiskModelError);
  });

  it("throws when deserialized shape is missing required fields", () => {
    expect(() => deserializeRiskModel(JSON.stringify({ assetClass: "invoice" }))).toThrow(
      RiskModelError,
    );
  });

  it("rejects a model with a duplicate factor id", () => {
    const model = makeModel();
    model.factors[1] = { ...model.factors[1]!, id: "payment-history" };
    expect(() => serializeRiskModel(model)).toThrow(RiskModelError);
  });

  it("rejects a model with an invalid weight", () => {
    const model = makeModel();
    model.factors[0]!.weight = -5;
    expect(() => serializeRiskModel(model)).toThrow(RiskModelError);
  });

  it("rejects a step threshold that is not finite (e.g. Infinity)", () => {
    const model = makeModel();
    model.factors[1]!.scoring = {
      type: "step",
      steps: [{ threshold: Number.POSITIVE_INFINITY, score: 0 }],
    };
    expect(() => serializeRiskModel(model)).toThrow(RiskModelError);
  });

  it("rejects an unrecognized scoring type", () => {
    const json = JSON.stringify({
      version: "1.0.0",
      assetClass: "invoice",
      factors: [
        { id: "f", label: "F", weight: 1, field: "x", scoring: { type: "mystery" } },
      ],
    });
    expect(() => deserializeRiskModel(json)).toThrow(RiskModelError);
  });

  it("validateSerializableModel accepts a well-formed model", () => {
    expect(() => validateSerializableModel(makeModel())).not.toThrow();
  });
});

describe("hydrateRiskModel", () => {
  it("produces a RiskModel usable by scoreAsset", () => {
    const live = hydrateRiskModel(makeModel());
    const result = scoreAsset(live, {
      onTimeRatio: 1,
      daysPastDue: 0,
      hasFlag: false,
      jurisdictionScore: 100,
    });
    expect(result.overallScore).toBeCloseTo(100);
    expect(result.tier).toBe("low");
  });

  it("reconstructs linear scoring correctly", () => {
    const live = hydrateRiskModel(makeModel());
    const result = scoreAsset(live, {
      onTimeRatio: 0.5,
      daysPastDue: 0,
      hasFlag: false,
      jurisdictionScore: 100,
    });
    const factor = result.breakdown.find((b) => b.id === "payment-history")!;
    expect(factor.subScore).toBeCloseTo(50);
  });

  it("reconstructs step scoring correctly", () => {
    const live = hydrateRiskModel(makeModel());
    const result = scoreAsset(live, {
      onTimeRatio: 1,
      daysPastDue: 45,
      hasFlag: false,
      jurisdictionScore: 100,
    });
    const factor = result.breakdown.find((b) => b.id === "delinquency")!;
    expect(factor.subScore).toBe(0);
  });

  it("reconstructs bool scoring correctly", () => {
    const live = hydrateRiskModel(makeModel());
    const result = scoreAsset(live, {
      onTimeRatio: 1,
      daysPastDue: 0,
      hasFlag: true,
      jurisdictionScore: 100,
    });
    const factor = result.breakdown.find((b) => b.id === "flag")!;
    expect(factor.subScore).toBe(0);
  });

  it("reconstructs clamp scoring correctly, clamping out-of-range values", () => {
    const live = hydrateRiskModel(makeModel());
    const result = scoreAsset(live, {
      onTimeRatio: 1,
      daysPastDue: 0,
      hasFlag: false,
      jurisdictionScore: 130,
    });
    const factor = result.breakdown.find((b) => b.id === "jurisdiction-risk")!;
    expect(factor.subScore).toBe(100);
  });

  it("supports linear scoring with invert (mirrors inverseLinearScore)", () => {
    const model = makeModel();
    model.factors[0]!.scoring = { type: "linear", min: 0, max: 1, invert: true };
    const live = hydrateRiskModel(model);
    const result = scoreAsset(live, {
      onTimeRatio: 0.2,
      daysPastDue: 0,
      hasFlag: false,
      jurisdictionScore: 100,
    });
    const factor = result.breakdown.find((b) => b.id === "payment-history")!;
    expect(factor.subScore).toBeCloseTo(80);
  });

  it("round trip (serialize -> deserialize -> hydrate) scores identically to hydrating directly", () => {
    const model = makeModel();
    const roundTripped = deserializeRiskModel<DemoFacts>(serializeRiskModel(model));
    const facts: DemoFacts = {
      onTimeRatio: 0.73,
      daysPastDue: 12,
      hasFlag: false,
      jurisdictionScore: 61,
    };
    const direct = scoreAsset(hydrateRiskModel(model), facts);
    const viaJson = scoreAsset(hydrateRiskModel(roundTripped), facts);
    expect(viaJson).toEqual(direct);
  });
});

describe("diffRiskModels", () => {
  it("reports no changes when comparing a model to itself", () => {
    const model = makeModel();
    const diff = diffRiskModels(model, model);
    expect(diff.versionChanged).toBe(false);
    expect(diff.addedFactorIds).toEqual([]);
    expect(diff.removedFactorIds).toEqual([]);
    expect(diff.weightChanges).toEqual([]);
    expect(diff.fieldChanges).toEqual([]);
    expect(diff.scoringChanges).toEqual([]);
    expect(diff.tierThresholdsChanged).toBe(false);
  });

  it("detects a version bump", () => {
    const from = makeModel();
    const to = { ...makeModel(), version: "1.1.0" };
    const diff = diffRiskModels(from, to);
    expect(diff.versionChanged).toBe(true);
    expect(diff.fromVersion).toBe("1.0.0");
    expect(diff.toVersion).toBe("1.1.0");
  });

  it("detects added and removed factors", () => {
    const from = makeModel();
    const to = makeModel();
    to.factors = to.factors.filter((f) => f.id !== "flag");
    to.factors.push({
      id: "new-factor",
      label: "New factor",
      weight: 5,
      field: "onTimeRatio",
      scoring: { type: "clamp" },
    });
    const diff = diffRiskModels(from, to);
    expect(diff.removedFactorIds).toEqual(["flag"]);
    expect(diff.addedFactorIds).toEqual(["new-factor"]);
  });

  it("detects weight changes", () => {
    const from = makeModel();
    const to = makeModel();
    to.factors[0]!.weight = 999;
    const diff = diffRiskModels(from, to);
    expect(diff.weightChanges).toEqual([
      { id: "payment-history", fromWeight: 40, toWeight: 999 },
    ]);
  });

  it("detects field changes", () => {
    const from = makeModel();
    const to = makeModel();
    to.factors[0]!.field = "jurisdictionScore";
    const diff = diffRiskModels(from, to);
    expect(diff.fieldChanges).toEqual([
      { id: "payment-history", fromField: "onTimeRatio", toField: "jurisdictionScore" },
    ]);
  });

  it("detects scoring spec changes", () => {
    const from = makeModel();
    const to = makeModel();
    to.factors[0]!.scoring = { type: "linear", min: 0, max: 2 };
    const diff = diffRiskModels(from, to);
    expect(diff.scoringChanges.length).toBe(1);
    expect(diff.scoringChanges[0]!.id).toBe("payment-history");
  });

  it("detects tier threshold changes", () => {
    const from = makeModel();
    const to = makeModel();
    to.tierThresholds = [
      { tier: "low", minScore: 90 },
      { tier: "critical", minScore: 0 },
    ];
    const diff = diffRiskModels(from, to);
    expect(diff.tierThresholdsChanged).toBe(true);
  });
});
