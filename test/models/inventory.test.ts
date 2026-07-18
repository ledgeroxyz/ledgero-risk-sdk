import { describe, expect, it } from "vitest";
import { scoreAsset } from "../../src/engine.js";
import { inventoryRiskModel, type InventoryFacts } from "../../src/models/inventory.js";

const bestCaseFacts: InventoryFacts = {
  inventoryValue: 500_000,
  annualTurnoverRatio: 8,
  obsolescenceRate: 0,
  insuranceCoverageRatio: 1,
  averageItemAgeMonths: 1,
  documentCompleteness: 1,
  extractionConfidence: 1,
  jurisdictionRiskScore: 100,
};

const worstCaseFacts: InventoryFacts = {
  inventoryValue: 500_000,
  annualTurnoverRatio: 0,
  obsolescenceRate: 0.5,
  insuranceCoverageRatio: 0,
  averageItemAgeMonths: 60,
  documentCompleteness: 0,
  extractionConfidence: 0,
  jurisdictionRiskScore: 0,
};

describe("inventoryRiskModel", () => {
  it("scores fast-turning, fully insured, fresh inventory as low risk", () => {
    const result = scoreAsset(inventoryRiskModel, bestCaseFacts);
    expect(result.overallScore).toBeGreaterThan(95);
    expect(result.tier).toBe("low");
  });

  it("scores stagnant, uninsured, aged, obsolete inventory as critical", () => {
    const result = scoreAsset(inventoryRiskModel, worstCaseFacts);
    expect(result.overallScore).toBeLessThan(10);
    expect(result.tier).toBe("critical");
  });

  it("rewards higher turnover, all else equal", () => {
    const slow = scoreAsset(inventoryRiskModel, { ...bestCaseFacts, annualTurnoverRatio: 1 });
    const fast = scoreAsset(inventoryRiskModel, { ...bestCaseFacts, annualTurnoverRatio: 8 });
    expect(fast.overallScore).toBeGreaterThan(slow.overallScore);
  });

  it("penalizes higher obsolescence rates", () => {
    const fresh = scoreAsset(inventoryRiskModel, { ...bestCaseFacts, obsolescenceRate: 0.05 });
    const stale = scoreAsset(inventoryRiskModel, { ...bestCaseFacts, obsolescenceRate: 0.4 });
    expect(stale.overallScore).toBeLessThan(fresh.overallScore);
  });

  it("includes a breakdown entry for every configured factor", () => {
    const result = scoreAsset(inventoryRiskModel, bestCaseFacts);
    const ids = result.breakdown.map((b) => b.id).sort();
    const expectedIds = inventoryRiskModel.factors.map((f) => f.id).sort();
    expect(ids).toEqual(expectedIds);
  });
});
