import { describe, expect, it } from "vitest";
import { createRiskEngine, mergeRiskModel, scoreAsset } from "../src/engine.js";
import { RiskModelError, type RiskModel } from "../src/types.js";
import { invoiceRiskModel } from "../src/models/invoice.js";

interface SyntheticFacts {
  a: number;
  b: number;
}

function makeModel(overrides: Partial<RiskModel<SyntheticFacts>> = {}): RiskModel<SyntheticFacts> {
  return {
    assetClass: "invoice",
    factors: [
      { id: "f1", label: "F1", weight: 30, score: (facts) => facts.a },
      { id: "f2", label: "F2", weight: 70, score: (facts) => facts.b },
    ],
    ...overrides,
  };
}

describe("scoreAsset — weighting math", () => {
  it("computes a weighted overall score from normalized weights", () => {
    const result = scoreAsset(makeModel(), { a: 100, b: 0 });
    // normalizedWeight: f1 = 0.3, f2 = 0.7 -> overall = 100*0.3 + 0*0.7 = 30
    expect(result.overallScore).toBeCloseTo(30);
  });

  it("weights do not need to sum to 100 — only relative weight matters", () => {
    const a = scoreAsset(
      makeModel({
        factors: [
          { id: "f1", label: "F1", weight: 3, score: () => 100 },
          { id: "f2", label: "F2", weight: 7, score: () => 0 },
        ],
      }),
      { a: 0, b: 0 },
    );
    expect(a.overallScore).toBeCloseTo(30);
  });

  it("produces normalizedWeight fractions that sum to 1", () => {
    const result = scoreAsset(makeModel(), { a: 50, b: 50 });
    const sum = result.breakdown.reduce((s, b) => s + b.normalizedWeight, 0);
    expect(sum).toBeCloseTo(1);
  });

  it("each contribution equals subScore * normalizedWeight", () => {
    const result = scoreAsset(makeModel(), { a: 40, b: 90 });
    for (const factor of result.breakdown) {
      expect(factor.contribution).toBeCloseTo(factor.subScore * factor.normalizedWeight);
    }
  });

  it("overall score equals the sum of all contributions", () => {
    const result = scoreAsset(makeModel(), { a: 62, b: 18 });
    const sum = result.breakdown.reduce((s, b) => s + b.contribution, 0);
    expect(result.overallScore).toBeCloseTo(sum);
  });

  it("clamps out-of-range sub-scores from factor functions", () => {
    const model = makeModel({
      factors: [
        { id: "f1", label: "F1", weight: 1, score: () => 500 },
        { id: "f2", label: "F2", weight: 1, score: () => -500 },
      ],
    });
    const result = scoreAsset(model, { a: 0, b: 0 });
    expect(result.breakdown[0]!.subScore).toBe(100);
    expect(result.breakdown[1]!.subScore).toBe(0);
    expect(result.overallScore).toBeCloseTo(50);
  });

  it("attaches the risk tier derived from the overall score", () => {
    const perfect = scoreAsset(makeModel(), { a: 100, b: 100 });
    expect(perfect.tier).toBe("low");

    const terrible = scoreAsset(makeModel(), { a: 0, b: 0 });
    expect(terrible.tier).toBe("critical");
  });

  it("respects custom tierThresholds on the model", () => {
    const model = makeModel({
      tierThresholds: [
        { tier: "low", minScore: 50 },
        { tier: "critical", minScore: 0 },
      ],
    });
    const result = scoreAsset(model, { a: 60, b: 60 });
    expect(result.tier).toBe("low");
  });

  it("returns the assetClass from the model", () => {
    const result = scoreAsset(makeModel({ assetClass: "property" }), { a: 10, b: 10 });
    expect(result.assetClass).toBe("property");
  });
});

describe("scoreAsset — validation errors", () => {
  it("throws when the model has no factors", () => {
    expect(() => scoreAsset(makeModel({ factors: [] }), { a: 1, b: 1 })).toThrow(RiskModelError);
  });

  it("throws on duplicate factor ids", () => {
    const model = makeModel({
      factors: [
        { id: "dup", label: "A", weight: 1, score: () => 10 },
        { id: "dup", label: "B", weight: 1, score: () => 20 },
      ],
    });
    expect(() => scoreAsset(model, { a: 0, b: 0 })).toThrow(RiskModelError);
  });

  it("throws on a negative weight", () => {
    const model = makeModel({
      factors: [{ id: "f1", label: "F1", weight: -5, score: () => 10 }],
    });
    expect(() => scoreAsset(model, { a: 0, b: 0 })).toThrow(RiskModelError);
  });

  it("throws when every factor has zero weight", () => {
    const model = makeModel({
      factors: [
        { id: "f1", label: "F1", weight: 0, score: () => 10 },
        { id: "f2", label: "F2", weight: 0, score: () => 20 },
      ],
    });
    expect(() => scoreAsset(model, { a: 0, b: 0 })).toThrow(RiskModelError);
  });

  it("throws when a factor scoring function returns NaN", () => {
    const model = makeModel({
      factors: [{ id: "f1", label: "F1", weight: 1, score: () => Number.NaN }],
    });
    expect(() => scoreAsset(model, { a: 0, b: 0 })).toThrow(RiskModelError);
  });

  it("throws when a factor id is empty", () => {
    const model = makeModel({
      factors: [{ id: "", label: "F1", weight: 1, score: () => 10 }],
    });
    expect(() => scoreAsset(model, { a: 0, b: 0 })).toThrow(RiskModelError);
  });
});

describe("createRiskEngine", () => {
  it("binds a model and produces the same result as scoreAsset", () => {
    const model = makeModel();
    const engine = createRiskEngine(model);
    const facts = { a: 77, b: 33 };
    expect(engine.score(facts)).toEqual(scoreAsset(model, facts));
  });

  it("exposes the bound model", () => {
    const model = makeModel();
    const engine = createRiskEngine(model);
    expect(engine.model).toBe(model);
  });

  it("validates the model eagerly at construction time", () => {
    expect(() => createRiskEngine(makeModel({ factors: [] }))).toThrow(RiskModelError);
  });
});

describe("mergeRiskModel", () => {
  it("overrides an existing factor's weight without touching others", () => {
    const merged = mergeRiskModel(invoiceRiskModel, {
      factors: [{ id: "payment-history", weight: 999 }],
    });
    const original = invoiceRiskModel.factors.find((f) => f.id === "payment-history")!;
    const overridden = merged.factors.find((f) => f.id === "payment-history")!;

    expect(overridden.weight).toBe(999);
    expect(overridden.score).toBe(original.score); // untouched fields preserved
    expect(merged.factors.length).toBe(invoiceRiskModel.factors.length);
  });

  it("does not mutate the base model", () => {
    const originalWeight = invoiceRiskModel.factors.find((f) => f.id === "payment-history")!
      .weight;
    mergeRiskModel(invoiceRiskModel, { factors: [{ id: "payment-history", weight: 1 }] });
    expect(invoiceRiskModel.factors.find((f) => f.id === "payment-history")!.weight).toBe(
      originalWeight,
    );
  });

  it("adds new factors via addFactors", () => {
    const merged = mergeRiskModel(invoiceRiskModel, {
      addFactors: [{ id: "custom-factor", label: "Custom", weight: 5, score: () => 50 }],
    });
    expect(merged.factors.length).toBe(invoiceRiskModel.factors.length + 1);
    expect(merged.factors.some((f) => f.id === "custom-factor")).toBe(true);
  });

  it("removes factors via removeFactorIds", () => {
    const merged = mergeRiskModel(invoiceRiskModel, {
      removeFactorIds: ["jurisdiction-risk"],
    });
    expect(merged.factors.some((f) => f.id === "jurisdiction-risk")).toBe(false);
    expect(merged.factors.length).toBe(invoiceRiskModel.factors.length - 1);
  });

  it("overrides tierThresholds when supplied", () => {
    const customThresholds = [
      { tier: "low" as const, minScore: 95 },
      { tier: "critical" as const, minScore: 0 },
    ];
    const merged = mergeRiskModel(invoiceRiskModel, { tierThresholds: customThresholds });
    expect(merged.tierThresholds).toBe(customThresholds);
  });

  it("produces a model usable directly by scoreAsset", () => {
    const merged = mergeRiskModel(invoiceRiskModel, {
      factors: [{ id: "payment-history", weight: 1000 }],
    });
    const facts = {
      invoiceAmount: 1000,
      buyerOnTimePaymentRatio: 1,
      daysPastDue: 0,
      buyerConcentration: 0,
      documentCompleteness: 1,
      extractionConfidence: 1,
      jurisdictionRiskScore: 100,
    };
    const result = scoreAsset(merged, facts);
    // payment-history now dominates the weighting and is a perfect 100.
    expect(result.overallScore).toBeGreaterThan(95);
  });
});
