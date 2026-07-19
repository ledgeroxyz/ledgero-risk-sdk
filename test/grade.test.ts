import { describe, expect, it } from "vitest";
import { toLetterGrade, tierToLetterGrade } from "../src/grade.js";
import { scoreAsset } from "../src/engine.js";
import { invoiceRiskModel, type InvoiceFacts } from "../src/models/invoice.js";

describe("toLetterGrade", () => {
  it("maps the dapp's exact thresholds (>=80 A, >=60 B, >=40 C, else D)", () => {
    expect(toLetterGrade(100)).toBe("A");
    expect(toLetterGrade(80)).toBe("A");
    expect(toLetterGrade(60)).toBe("B");
    expect(toLetterGrade(40)).toBe("C");
    expect(toLetterGrade(0)).toBe("D");
  });

  it("is correct at the boundary values (79/80, 59/60, 39/40)", () => {
    expect(toLetterGrade(80)).toBe("A");
    expect(toLetterGrade(79)).toBe("B");
    expect(toLetterGrade(79.999)).toBe("B");

    expect(toLetterGrade(60)).toBe("B");
    expect(toLetterGrade(59)).toBe("C");
    expect(toLetterGrade(59.999)).toBe("C");

    expect(toLetterGrade(40)).toBe("C");
    expect(toLetterGrade(39)).toBe("D");
    expect(toLetterGrade(39.999)).toBe("D");
  });

  it("treats non-finite scores as the worst grade (D)", () => {
    expect(toLetterGrade(Number.NaN)).toBe("D");
    expect(toLetterGrade(Number.POSITIVE_INFINITY)).toBe("D");
    expect(toLetterGrade(Number.NEGATIVE_INFINITY)).toBe("D");
  });
});

describe("tierToLetterGrade", () => {
  it("maps each tier one-to-one onto the letter ladder", () => {
    expect(tierToLetterGrade("low")).toBe("A");
    expect(tierToLetterGrade("medium")).toBe("B");
    expect(tierToLetterGrade("high")).toBe("C");
    expect(tierToLetterGrade("critical")).toBe("D");
  });

  it("agrees with toLetterGrade at each tier's default score band", () => {
    // Default tier ladder shares the 80/60/40 thresholds.
    expect(tierToLetterGrade("low")).toBe(toLetterGrade(80));
    expect(tierToLetterGrade("medium")).toBe(toLetterGrade(60));
    expect(tierToLetterGrade("high")).toBe(toLetterGrade(40));
    expect(tierToLetterGrade("critical")).toBe(toLetterGrade(0));
  });
});

describe("scoreAsset surfaces letterGrade", () => {
  const goodFacts: InvoiceFacts = {
    invoiceAmount: 50_000,
    buyerOnTimePaymentRatio: 1,
    daysPastDue: 0,
    buyerConcentration: 0.05,
    documentCompleteness: 1,
    extractionConfidence: 1,
    jurisdictionRiskScore: 100,
  };

  it("adds a letterGrade field consistent with toLetterGrade(overallScore)", () => {
    const result = scoreAsset(invoiceRiskModel, goodFacts);
    expect(result.letterGrade).toBe(toLetterGrade(result.overallScore));
  });

  it("grades a strong invoice as A", () => {
    const result = scoreAsset(invoiceRiskModel, goodFacts);
    expect(result.overallScore).toBeGreaterThanOrEqual(80);
    expect(result.letterGrade).toBe("A");
  });
});
