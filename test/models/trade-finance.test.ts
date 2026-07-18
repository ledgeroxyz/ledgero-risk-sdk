import { describe, expect, it } from "vitest";
import { scoreAsset } from "../../src/engine.js";
import { tradeFinanceRiskModel, type TradeFinanceFacts } from "../../src/models/trade-finance.js";

const bestCaseFacts: TradeFinanceFacts = {
  instrumentAmount: 500_000,
  issuingBankCreditRating: 100,
  discrepancyCount: 0,
  daysToMaturity: 20,
  counterpartyConcentration: 0,
  documentCompleteness: 1,
  extractionConfidence: 1,
  jurisdictionRiskScore: 100,
};

const worstCaseFacts: TradeFinanceFacts = {
  instrumentAmount: 500_000,
  issuingBankCreditRating: 0,
  discrepancyCount: 20,
  daysToMaturity: 400,
  counterpartyConcentration: 1,
  documentCompleteness: 0,
  extractionConfidence: 0,
  jurisdictionRiskScore: 0,
};

describe("tradeFinanceRiskModel", () => {
  it("produces a near-perfect score and low tier for ideal facts", () => {
    const result = scoreAsset(tradeFinanceRiskModel, bestCaseFacts);
    expect(result.overallScore).toBeGreaterThan(95);
    expect(result.tier).toBe("low");
    expect(result.assetClass).toBe("trade-finance");
  });

  it("produces a near-zero score and critical tier for worst-case facts", () => {
    const result = scoreAsset(tradeFinanceRiskModel, worstCaseFacts);
    expect(result.overallScore).toBeLessThan(10);
    expect(result.tier).toBe("critical");
  });

  it("ranks more documentary discrepancies as worse, all else equal", () => {
    const clean = scoreAsset(tradeFinanceRiskModel, { ...bestCaseFacts, discrepancyCount: 0 });
    const flagged = scoreAsset(tradeFinanceRiskModel, { ...bestCaseFacts, discrepancyCount: 8 });
    expect(flagged.overallScore).toBeLessThan(clean.overallScore);
  });

  it("ranks a longer tenor to maturity as worse, all else equal", () => {
    const shortTenor = scoreAsset(tradeFinanceRiskModel, { ...bestCaseFacts, daysToMaturity: 15 });
    const longTenor = scoreAsset(tradeFinanceRiskModel, { ...bestCaseFacts, daysToMaturity: 200 });
    expect(longTenor.overallScore).toBeLessThan(shortTenor.overallScore);
  });

  it("ranks higher counterparty concentration as worse, all else equal", () => {
    const diversified = scoreAsset(tradeFinanceRiskModel, {
      ...bestCaseFacts,
      counterpartyConcentration: 0.1,
    });
    const concentrated = scoreAsset(tradeFinanceRiskModel, {
      ...bestCaseFacts,
      counterpartyConcentration: 0.9,
    });
    expect(concentrated.overallScore).toBeLessThan(diversified.overallScore);
  });

  it("includes a breakdown entry for every configured factor", () => {
    const result = scoreAsset(tradeFinanceRiskModel, bestCaseFacts);
    const ids = result.breakdown.map((b) => b.id).sort();
    const expectedIds = tradeFinanceRiskModel.factors.map((f) => f.id).sort();
    expect(ids).toEqual(expectedIds);
  });

  it("passes externally supplied jurisdiction risk through directly (clamped)", () => {
    const result = scoreAsset(tradeFinanceRiskModel, { ...bestCaseFacts, jurisdictionRiskScore: 130 });
    const jurisdictionFactor = result.breakdown.find((b) => b.id === "jurisdiction-risk")!;
    expect(jurisdictionFactor.subScore).toBe(100);
  });
});
