import { describe, expect, it } from "vitest";
import { scoreAsset } from "../../src/engine.js";
import { propertyRiskModel, type PropertyFacts } from "../../src/models/property.js";

const bestCaseFacts: PropertyFacts = {
  appraisedValue: 1_000_000,
  outstandingLoanAmount: 100_000,
  propertyAgeYears: 2,
  occupancyRatio: 1,
  titleDefects: false,
  documentCompleteness: 1,
  extractionConfidence: 1,
  jurisdictionRiskScore: 100,
};

const worstCaseFacts: PropertyFacts = {
  appraisedValue: 1_000_000,
  outstandingLoanAmount: 10_000_000,
  propertyAgeYears: 100,
  occupancyRatio: 0,
  titleDefects: true,
  documentCompleteness: 0,
  extractionConfidence: 0,
  jurisdictionRiskScore: 0,
};

describe("propertyRiskModel", () => {
  it("scores an ideal, unencumbered, occupied property as low risk", () => {
    const result = scoreAsset(propertyRiskModel, bestCaseFacts);
    expect(result.overallScore).toBeGreaterThan(90);
    expect(result.tier).toBe("low");
  });

  it("scores a fully leveraged, vacant, title-defective property as critical", () => {
    const result = scoreAsset(propertyRiskModel, worstCaseFacts);
    expect(result.overallScore).toBeLessThan(15);
    expect(result.tier).toBe("critical");
  });

  it("treats an unencumbered property (no loan) as fully covered", () => {
    const result = scoreAsset(propertyRiskModel, { ...bestCaseFacts, outstandingLoanAmount: 0 });
    const coverageFactor = result.breakdown.find((b) => b.id === "collateral-coverage")!;
    expect(coverageFactor.subScore).toBe(100);
  });

  it("heavily penalizes title defects independent of other factors", () => {
    const clean = scoreAsset(propertyRiskModel, { ...bestCaseFacts, titleDefects: false });
    const defective = scoreAsset(propertyRiskModel, { ...bestCaseFacts, titleDefects: true });
    expect(defective.overallScore).toBeLessThan(clean.overallScore);

    const titleFactor = defective.breakdown.find((b) => b.id === "title-defects")!;
    expect(titleFactor.subScore).toBe(0);
  });

  it("penalizes higher loan-to-value (lower collateral coverage)", () => {
    const lowLtv = scoreAsset(propertyRiskModel, { ...bestCaseFacts, outstandingLoanAmount: 100_000 });
    const highLtv = scoreAsset(propertyRiskModel, { ...bestCaseFacts, outstandingLoanAmount: 900_000 });
    expect(highLtv.overallScore).toBeLessThan(lowLtv.overallScore);
  });

  it("includes a breakdown entry for every configured factor", () => {
    const result = scoreAsset(propertyRiskModel, bestCaseFacts);
    const ids = result.breakdown.map((b) => b.id).sort();
    const expectedIds = propertyRiskModel.factors.map((f) => f.id).sort();
    expect(ids).toEqual(expectedIds);
  });
});
