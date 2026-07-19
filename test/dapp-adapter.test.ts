import { describe, expect, it } from "vitest";
import { toDappRiskFactor, toDappRiskFactors } from "../src/dapp-adapter.js";
import { scoreAsset } from "../src/engine.js";
import { otherRiskModel, type OtherFacts } from "../src/models/other.js";
import type { FactorContribution, ScoreResult } from "../src/types.js";

function contribution(partial: Partial<FactorContribution> & { id: string }): FactorContribution {
  return {
    label: partial.label ?? partial.id,
    weight: partial.weight ?? 10,
    normalizedWeight: partial.normalizedWeight ?? 0.25,
    subScore: partial.subScore ?? 50,
    contribution: partial.contribution ?? 0,
    ...partial,
  };
}

describe("toDappRiskFactor — impact classification", () => {
  it("classifies a high sub-score as positive", () => {
    const f = toDappRiskFactor(contribution({ id: "a", subScore: 90 }));
    expect(f.impact).toBe("positive");
  });

  it("classifies a low sub-score as negative", () => {
    const f = toDappRiskFactor(contribution({ id: "a", subScore: 10 }));
    expect(f.impact).toBe("negative");
  });

  it("classifies a mid-scale sub-score as neutral", () => {
    const f = toDappRiskFactor(contribution({ id: "a", subScore: 50 }));
    expect(f.impact).toBe("neutral");
  });

  it("treats the default neutral band [45, 55] boundaries as neutral (inclusive)", () => {
    expect(toDappRiskFactor(contribution({ id: "a", subScore: 55 })).impact).toBe("neutral");
    expect(toDappRiskFactor(contribution({ id: "a", subScore: 45 })).impact).toBe("neutral");
    expect(toDappRiskFactor(contribution({ id: "a", subScore: 55.01 })).impact).toBe("positive");
    expect(toDappRiskFactor(contribution({ id: "a", subScore: 44.99 })).impact).toBe("negative");
  });

  it("honors a custom neutral band", () => {
    const f = toDappRiskFactor(contribution({ id: "a", subScore: 70 }), {
      neutralLow: 30,
      neutralHigh: 80,
    });
    expect(f.impact).toBe("neutral");
  });

  it("uses the factor label and produces a human-readable detail sentence", () => {
    const f = toDappRiskFactor(
      contribution({ id: "collateral", label: "Collateral coverage", subScore: 88, normalizedWeight: 0.3 }),
    );
    expect(f.label).toBe("Collateral coverage");
    expect(f.detail).toContain("Collateral coverage");
    expect(f.detail).toContain("88/100");
    expect(f.detail).toContain("30%");
    expect(f.detail).toContain("supports the asset");
  });
});

describe("toDappRiskFactors — full result conversion", () => {
  const goodFacts: OtherFacts = {
    documentCompleteness: 1,
    hasCounterparty: true,
    claimedValue: 50_000,
    extractionConfidence: 1,
  };

  it("produces exactly the dapp's { label, impact, detail } shape for every factor", () => {
    const result = scoreAsset(otherRiskModel, goodFacts);
    const dappFactors = toDappRiskFactors(result);

    expect(dappFactors).toHaveLength(result.breakdown.length);
    for (const f of dappFactors) {
      expect(Object.keys(f).sort()).toEqual(["detail", "impact", "label"]);
      expect(["positive", "negative", "neutral"]).toContain(f.impact);
      expect(typeof f.label).toBe("string");
      expect(typeof f.detail).toBe("string");
    }
  });

  it("reflects a strong asset as mostly positive impacts", () => {
    const result = scoreAsset(otherRiskModel, goodFacts);
    const dappFactors = toDappRiskFactors(result);
    const positives = dappFactors.filter((f) => f.impact === "positive").length;
    expect(positives).toBeGreaterThan(0);
    expect(dappFactors.some((f) => f.impact === "negative")).toBe(false);
  });

  it("reflects a weak asset with at least one negative impact", () => {
    const weak: OtherFacts = {
      documentCompleteness: 0,
      hasCounterparty: false,
      claimedValue: 10_000_000,
      extractionConfidence: 0,
    };
    const result = scoreAsset(otherRiskModel, weak);
    const dappFactors = toDappRiskFactors(result);
    expect(dappFactors.some((f) => f.impact === "negative")).toBe(true);
  });

  it("preserves factor order from the breakdown", () => {
    const result: ScoreResult = scoreAsset(otherRiskModel, goodFacts);
    const dappFactors = toDappRiskFactors(result);
    expect(dappFactors.map((f) => f.label)).toEqual(result.breakdown.map((b) => b.label));
  });
});
