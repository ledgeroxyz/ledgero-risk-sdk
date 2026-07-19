import { describe, expect, it } from "vitest";
import { scoreAsset } from "../../src/engine.js";
import { otherRiskModel, type OtherFacts } from "../../src/models/other.js";
import { defaultRiskModels } from "../../src/models/index.js";

const bestCaseFacts: OtherFacts = {
  documentCompleteness: 1,
  hasCounterparty: true,
  claimedValue: 50_000,
  extractionConfidence: 1,
};

const worstCaseFacts: OtherFacts = {
  documentCompleteness: 0,
  hasCounterparty: false,
  claimedValue: 10_000_000,
  extractionConfidence: 0,
};

describe("otherRiskModel", () => {
  it("uses the `other` asset class", () => {
    expect(otherRiskModel.assetClass).toBe("other");
  });

  it("scores a complete, low-value, counterparty-backed asset as low risk", () => {
    const result = scoreAsset(otherRiskModel, bestCaseFacts);
    expect(result.overallScore).toBeGreaterThan(90);
    expect(result.tier).toBe("low");
    expect(result.assetClass).toBe("other");
  });

  it("scores a thin, anonymous, high-value asset as high/critical risk", () => {
    const result = scoreAsset(otherRiskModel, worstCaseFacts);
    expect(result.overallScore).toBeLessThan(40);
  });

  it("penalizes a missing counterparty", () => {
    const withCp = scoreAsset(otherRiskModel, bestCaseFacts);
    const withoutCp = scoreAsset(otherRiskModel, { ...bestCaseFacts, hasCounterparty: false });
    expect(withoutCp.overallScore).toBeLessThan(withCp.overallScore);

    const factor = withoutCp.breakdown.find((b) => b.id === "counterparty-known")!;
    expect(factor.subScore).toBe(40);
  });

  it("penalizes larger claimed values", () => {
    const small = scoreAsset(otherRiskModel, { ...bestCaseFacts, claimedValue: 50_000 });
    const large = scoreAsset(otherRiskModel, { ...bestCaseFacts, claimedValue: 10_000_000 });
    expect(large.overallScore).toBeLessThan(small.overallScore);
  });

  it("defaults missing extractionConfidence to a neutral 0.5", () => {
    const withDefault = scoreAsset(otherRiskModel, {
      documentCompleteness: 1,
      hasCounterparty: true,
      claimedValue: 50_000,
    });
    const explicit = scoreAsset(otherRiskModel, { ...bestCaseFacts, extractionConfidence: 0.5 });
    const a = withDefault.breakdown.find((b) => b.id === "valuation-confidence")!;
    const b = explicit.breakdown.find((b) => b.id === "valuation-confidence")!;
    expect(a.subScore).toBe(b.subScore);
    expect(a.subScore).toBe(50);
  });

  it("is registered under `other` in defaultRiskModels", () => {
    expect(defaultRiskModels.other).toBe(otherRiskModel);
  });

  it("includes a breakdown entry for every configured factor", () => {
    const result = scoreAsset(otherRiskModel, bestCaseFacts);
    const ids = result.breakdown.map((b) => b.id).sort();
    const expectedIds = otherRiskModel.factors.map((f) => f.id).sort();
    expect(ids).toEqual(expectedIds);
  });
});
