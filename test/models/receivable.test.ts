import { describe, expect, it } from "vitest";
import { scoreAsset } from "../../src/engine.js";
import { receivableRiskModel, type ReceivableFacts } from "../../src/models/receivable.js";

const bestCaseFacts: ReceivableFacts = {
  poolOutstandingAmount: 1_000_000,
  weightedAverageDaysSalesOutstanding: 20,
  delinquencyRate30Plus: 0,
  topCounterpartyConcentration: 0.05,
  collateralCoverageRatio: 1.5,
  documentCompleteness: 1,
  extractionConfidence: 1,
  jurisdictionRiskScore: 100,
};

const worstCaseFacts: ReceivableFacts = {
  poolOutstandingAmount: 1_000_000,
  weightedAverageDaysSalesOutstanding: 180,
  delinquencyRate30Plus: 0.9,
  topCounterpartyConcentration: 1,
  collateralCoverageRatio: 0,
  documentCompleteness: 0,
  extractionConfidence: 0,
  jurisdictionRiskScore: 0,
};

describe("receivableRiskModel", () => {
  it("scores an ideal receivable pool as low risk", () => {
    const result = scoreAsset(receivableRiskModel, bestCaseFacts);
    expect(result.overallScore).toBeGreaterThan(95);
    expect(result.tier).toBe("low");
  });

  it("scores a distressed receivable pool as critical", () => {
    const result = scoreAsset(receivableRiskModel, worstCaseFacts);
    expect(result.overallScore).toBeLessThan(10);
    expect(result.tier).toBe("critical");
  });

  it("rewards higher collateral coverage, all else equal", () => {
    const uncovered = scoreAsset(receivableRiskModel, { ...bestCaseFacts, collateralCoverageRatio: 0 });
    const covered = scoreAsset(receivableRiskModel, { ...bestCaseFacts, collateralCoverageRatio: 1.5 });
    expect(covered.overallScore).toBeGreaterThan(uncovered.overallScore);
  });

  it("penalizes higher 30+ day delinquency rates", () => {
    const low = scoreAsset(receivableRiskModel, { ...bestCaseFacts, delinquencyRate30Plus: 0.05 });
    const high = scoreAsset(receivableRiskModel, { ...bestCaseFacts, delinquencyRate30Plus: 0.4 });
    expect(high.overallScore).toBeLessThan(low.overallScore);
  });

  it("includes a breakdown entry for every configured factor", () => {
    const result = scoreAsset(receivableRiskModel, bestCaseFacts);
    const ids = result.breakdown.map((b) => b.id).sort();
    const expectedIds = receivableRiskModel.factors.map((f) => f.id).sort();
    expect(ids).toEqual(expectedIds);
  });
});
