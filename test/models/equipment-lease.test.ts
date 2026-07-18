import { describe, expect, it } from "vitest";
import { scoreAsset } from "../../src/engine.js";
import {
  equipmentLeaseRiskModel,
  type EquipmentLeaseFacts,
} from "../../src/models/equipment-lease.js";

const bestCaseFacts: EquipmentLeaseFacts = {
  equipmentValue: 250_000,
  remainingUsefulLifeYears: 10,
  monthsInArrears: 0,
  utilizationRatio: 1,
  maintenanceCompliant: true,
  lesseeCreditScore: 100,
  documentCompleteness: 1,
  extractionConfidence: 1,
  jurisdictionRiskScore: 100,
};

const worstCaseFacts: EquipmentLeaseFacts = {
  equipmentValue: 250_000,
  remainingUsefulLifeYears: 0,
  monthsInArrears: 12,
  utilizationRatio: 0,
  maintenanceCompliant: false,
  lesseeCreditScore: 0,
  documentCompleteness: 0,
  extractionConfidence: 0,
  jurisdictionRiskScore: 0,
};

describe("equipmentLeaseRiskModel", () => {
  it("produces a near-perfect score and low tier for ideal facts", () => {
    const result = scoreAsset(equipmentLeaseRiskModel, bestCaseFacts);
    expect(result.overallScore).toBeGreaterThan(95);
    expect(result.tier).toBe("low");
    expect(result.assetClass).toBe("equipment-lease");
  });

  it("produces a near-zero score and critical tier for worst-case facts", () => {
    const result = scoreAsset(equipmentLeaseRiskModel, worstCaseFacts);
    expect(result.overallScore).toBeLessThan(10);
    expect(result.tier).toBe("critical");
  });

  it("ranks a lessee in arrears as worse than a current one, all else equal", () => {
    const current = scoreAsset(equipmentLeaseRiskModel, { ...bestCaseFacts, monthsInArrears: 0 });
    const inArrears = scoreAsset(equipmentLeaseRiskModel, { ...bestCaseFacts, monthsInArrears: 4 });
    expect(inArrears.overallScore).toBeLessThan(current.overallScore);
  });

  it("penalizes equipment that is not maintenance-compliant", () => {
    const compliant = scoreAsset(equipmentLeaseRiskModel, {
      ...bestCaseFacts,
      maintenanceCompliant: true,
    });
    const nonCompliant = scoreAsset(equipmentLeaseRiskModel, {
      ...bestCaseFacts,
      maintenanceCompliant: false,
    });
    expect(nonCompliant.overallScore).toBeLessThan(compliant.overallScore);
  });

  it("ranks a weaker lessee credit score as worse, all else equal", () => {
    const strong = scoreAsset(equipmentLeaseRiskModel, { ...bestCaseFacts, lesseeCreditScore: 90 });
    const weak = scoreAsset(equipmentLeaseRiskModel, { ...bestCaseFacts, lesseeCreditScore: 20 });
    expect(weak.overallScore).toBeLessThan(strong.overallScore);
  });

  it("includes a breakdown entry for every configured factor", () => {
    const result = scoreAsset(equipmentLeaseRiskModel, bestCaseFacts);
    const ids = result.breakdown.map((b) => b.id).sort();
    const expectedIds = equipmentLeaseRiskModel.factors.map((f) => f.id).sort();
    expect(ids).toEqual(expectedIds);
  });

  it("passes externally supplied jurisdiction risk through directly (clamped)", () => {
    const result = scoreAsset(equipmentLeaseRiskModel, {
      ...bestCaseFacts,
      jurisdictionRiskScore: 130,
    });
    const jurisdictionFactor = result.breakdown.find((b) => b.id === "jurisdiction-risk")!;
    expect(jurisdictionFactor.subScore).toBe(100);
  });
});
