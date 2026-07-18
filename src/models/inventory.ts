import type { RiskFactor, RiskModel } from "../types.js";
import { inverseLinearScore, linearScore, stepScore } from "../scoring-utils.js";

/**
 * Structured facts about a physical inventory pool being underwritten
 * for tokenization (e.g. warehouse receivables, commodity stock).
 */
export interface InventoryFacts {
  /** Total appraised/book value of the inventory pool. */
  inventoryValue: number;
  /** Annualized inventory turnover ratio (times/year the stock is sold and replaced). */
  annualTurnoverRatio: number;
  /** Fraction (0-1) of the pool considered obsolete, expired, or unsellable at book value. */
  obsolescenceRate: number;
  /** Insurance coverage ratio: insured value / inventory value. */
  insuranceCoverageRatio: number;
  /** Average age of items in the pool, in months. */
  averageItemAgeMonths: number;
  /** Fraction (0-1) of required supporting documentation present and verified. */
  documentCompleteness: number;
  /** Confidence (0-1) that the valuation/extraction correctly captured the pool's figures. */
  extractionConfidence: number;
  /** Externally sourced jurisdiction risk score for the warehouse/storage location, 0-100 (100 = safest). */
  jurisdictionRiskScore: number;
}

const inventoryFactors: RiskFactor<InventoryFacts>[] = [
  {
    id: "turnover",
    label: "Inventory turnover",
    description: "Rewards faster-turning inventory as a proxy for liquidity and demand.",
    weight: 20,
    score: (facts) => linearScore(facts.annualTurnoverRatio, { min: 0, max: 8 }),
  },
  {
    id: "obsolescence",
    label: "Obsolescence rate",
    description: "Penalizes pools with a high share of obsolete or unsellable stock.",
    weight: 20,
    score: (facts) => inverseLinearScore(facts.obsolescenceRate, { min: 0, max: 0.5 }),
  },
  {
    id: "insurance-coverage",
    label: "Insurance coverage ratio",
    description: "Rewards inventory that is fully insured against loss or damage.",
    weight: 15,
    score: (facts) => linearScore(facts.insuranceCoverageRatio, { min: 0, max: 1 }),
  },
  {
    id: "asset-age",
    label: "Item age / depreciation",
    description: "Penalizes older stock, which is more prone to obsolescence and value decay.",
    weight: 15,
    score: (facts) =>
      stepScore(facts.averageItemAgeMonths, [
        { threshold: 3, score: 100 },
        { threshold: 6, score: 85 },
        { threshold: 12, score: 65 },
        { threshold: 24, score: 40 },
        { threshold: Number.POSITIVE_INFINITY, score: 15 },
      ]),
  },
  {
    id: "document-completeness",
    label: "Document completeness",
    weight: 10,
    score: (facts) => linearScore(facts.documentCompleteness, { min: 0, max: 1 }),
  },
  {
    id: "valuation-confidence",
    label: "Valuation/extraction confidence",
    weight: 10,
    score: (facts) => linearScore(facts.extractionConfidence, { min: 0, max: 1 }),
  },
  {
    id: "jurisdiction-risk",
    label: "Jurisdiction risk",
    weight: 10,
    score: (facts) => Math.min(100, Math.max(0, facts.jurisdictionRiskScore)),
  },
];

/**
 * Default LEDGERO risk model for inventory assets. Fully overridable via
 * `mergeRiskModel` or by constructing your own `RiskModel<InventoryFacts>`.
 */
export const inventoryRiskModel: RiskModel<InventoryFacts> = {
  assetClass: "inventory",
  name: "Default inventory risk model",
  description: "Default LEDGERO risk model for physical inventory assets.",
  factors: inventoryFactors,
};
