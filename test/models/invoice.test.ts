import { describe, expect, it } from "vitest";
import { scoreAsset } from "../../src/engine.js";
import { invoiceRiskModel, type InvoiceFacts } from "../../src/models/invoice.js";

const bestCaseFacts: InvoiceFacts = {
  invoiceAmount: 10_000,
  buyerOnTimePaymentRatio: 1,
  daysPastDue: 0,
  buyerConcentration: 0,
  documentCompleteness: 1,
  extractionConfidence: 1,
  jurisdictionRiskScore: 100,
};

const worstCaseFacts: InvoiceFacts = {
  invoiceAmount: 10_000,
  buyerOnTimePaymentRatio: 0,
  daysPastDue: 200,
  buyerConcentration: 1,
  documentCompleteness: 0,
  extractionConfidence: 0,
  jurisdictionRiskScore: 0,
};

describe("invoiceRiskModel", () => {
  it("produces a near-perfect score and low tier for ideal facts", () => {
    const result = scoreAsset(invoiceRiskModel, bestCaseFacts);
    expect(result.overallScore).toBeGreaterThan(95);
    expect(result.tier).toBe("low");
    expect(result.assetClass).toBe("invoice");
  });

  it("produces a near-zero score and critical tier for worst-case facts", () => {
    const result = scoreAsset(invoiceRiskModel, worstCaseFacts);
    expect(result.overallScore).toBeLessThan(10);
    expect(result.tier).toBe("critical");
  });

  it("ranks a partially delinquent invoice worse than a current one, all else equal", () => {
    const current = scoreAsset(invoiceRiskModel, { ...bestCaseFacts, daysPastDue: 0 });
    const delinquent = scoreAsset(invoiceRiskModel, { ...bestCaseFacts, daysPastDue: 45 });
    expect(delinquent.overallScore).toBeLessThan(current.overallScore);
  });

  it("ranks higher counterparty concentration as worse, all else equal", () => {
    const diversified = scoreAsset(invoiceRiskModel, { ...bestCaseFacts, buyerConcentration: 0.1 });
    const concentrated = scoreAsset(invoiceRiskModel, { ...bestCaseFacts, buyerConcentration: 0.9 });
    expect(concentrated.overallScore).toBeLessThan(diversified.overallScore);
  });

  it("includes a breakdown entry for every configured factor", () => {
    const result = scoreAsset(invoiceRiskModel, bestCaseFacts);
    const ids = result.breakdown.map((b) => b.id).sort();
    const expectedIds = invoiceRiskModel.factors.map((f) => f.id).sort();
    expect(ids).toEqual(expectedIds);
  });

  it("passes externally supplied jurisdiction risk through directly (clamped)", () => {
    const result = scoreAsset(invoiceRiskModel, { ...bestCaseFacts, jurisdictionRiskScore: 130 });
    const jurisdictionFactor = result.breakdown.find((b) => b.id === "jurisdiction-risk")!;
    expect(jurisdictionFactor.subScore).toBe(100);
  });
});
