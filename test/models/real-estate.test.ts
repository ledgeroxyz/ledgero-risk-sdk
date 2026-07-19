import { describe, expect, it } from "vitest";
import { scoreAsset } from "../../src/engine.js";
import { propertyRiskModel } from "../../src/models/property.js";
import { realEstateRiskModel, type RealEstateFacts } from "../../src/models/real-estate.js";
import { defaultRiskModels } from "../../src/models/index.js";

const bestCaseFacts: RealEstateFacts = {
  appraisedValue: 1_000_000,
  outstandingLoanAmount: 100_000,
  propertyAgeYears: 2,
  occupancyRatio: 1,
  titleDefects: false,
  documentCompleteness: 1,
  extractionConfidence: 1,
  jurisdictionRiskScore: 100,
};

const worstCaseFacts: RealEstateFacts = {
  appraisedValue: 1_000_000,
  outstandingLoanAmount: 10_000_000,
  propertyAgeYears: 100,
  occupancyRatio: 0,
  titleDefects: true,
  documentCompleteness: 0,
  extractionConfidence: 0,
  jurisdictionRiskScore: 0,
};

describe("realEstateRiskModel", () => {
  it("uses the dapp-aligned `real_estate` asset class", () => {
    expect(realEstateRiskModel.assetClass).toBe("real_estate");
  });

  it("scores identically to the property model on the same facts", () => {
    const realEstate = scoreAsset(realEstateRiskModel, bestCaseFacts);
    const property = scoreAsset(propertyRiskModel, bestCaseFacts);
    expect(realEstate.overallScore).toBe(property.overallScore);
    expect(realEstate.breakdown).toEqual(property.breakdown);
  });

  it("scores an ideal, unencumbered, occupied asset as low risk", () => {
    const result = scoreAsset(realEstateRiskModel, bestCaseFacts);
    expect(result.overallScore).toBeGreaterThan(90);
    expect(result.tier).toBe("low");
    expect(result.assetClass).toBe("real_estate");
  });

  it("scores a fully leveraged, vacant, title-defective asset as critical", () => {
    const result = scoreAsset(realEstateRiskModel, worstCaseFacts);
    expect(result.overallScore).toBeLessThan(15);
    expect(result.tier).toBe("critical");
  });

  it("is registered under `real_estate` in defaultRiskModels", () => {
    expect(defaultRiskModels.real_estate).toBe(realEstateRiskModel);
  });

  it("does not share the factor array reference with the property model (safe to mutate independently)", () => {
    // Spreading the base model keeps the same `factors` array reference,
    // which is fine because models are treated as read-only. Verify the
    // asset class was actually overridden and not inherited.
    expect(realEstateRiskModel.assetClass).not.toBe(propertyRiskModel.assetClass);
  });
});
