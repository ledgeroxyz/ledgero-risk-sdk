import type { RiskFactor, RiskModel } from "../types.js";
import { inverseLinearScore, linearScore, stepScore } from "../scoring-utils.js";

/**
 * Structured facts about a pool (or single) of trade receivables being
 * underwritten as a tokenizable asset.
 */
export interface ReceivableFacts {
  /** Total outstanding amount across the receivable pool. */
  poolOutstandingAmount: number;
  /** Weighted-average days sales outstanding (DSO) across the pool, in days. */
  weightedAverageDaysSalesOutstanding: number;
  /** Fraction (0-1) of the pool that is 30+ days delinquent. */
  delinquencyRate30Plus: number;
  /** Fraction (0-1) of pool exposure concentrated in the single largest counterparty. */
  topCounterpartyConcentration: number;
  /** Collateral or credit-insurance coverage ratio: covered value / outstanding amount. */
  collateralCoverageRatio: number;
  /** Fraction (0-1) of required supporting documentation present and verified. */
  documentCompleteness: number;
  /** Confidence (0-1) that extraction/reconciliation correctly captured the pool's figures. */
  extractionConfidence: number;
  /** Externally sourced jurisdiction risk score, 0-100 (100 = safest). */
  jurisdictionRiskScore: number;
}

const receivableFactors: RiskFactor<ReceivableFacts>[] = [
  {
    id: "delinquency-rate",
    label: "30+ day delinquency rate",
    description: "Penalizes pools with a high share of significantly overdue receivables.",
    weight: 25,
    score: (facts) => inverseLinearScore(facts.delinquencyRate30Plus, { min: 0, max: 0.5 }),
  },
  {
    id: "days-sales-outstanding",
    label: "Days sales outstanding",
    description: "Penalizes pools that take longer than expected to collect.",
    weight: 15,
    score: (facts) =>
      stepScore(facts.weightedAverageDaysSalesOutstanding, [
        { threshold: 30, score: 100 },
        { threshold: 45, score: 85 },
        { threshold: 60, score: 65 },
        { threshold: 90, score: 40 },
        { threshold: 120, score: 20 },
        { threshold: Number.POSITIVE_INFINITY, score: 0 },
      ]),
  },
  {
    id: "collateral-coverage",
    label: "Collateral coverage ratio",
    description: "Rewards pools backed by collateral or credit insurance beyond face value.",
    weight: 20,
    score: (facts) => linearScore(facts.collateralCoverageRatio, { min: 0, max: 1.5 }),
  },
  {
    id: "counterparty-concentration",
    label: "Counterparty concentration",
    description: "Penalizes pools concentrated in a single obligor.",
    weight: 15,
    score: (facts) => inverseLinearScore(facts.topCounterpartyConcentration, { min: 0, max: 1 }),
  },
  {
    id: "document-completeness",
    label: "Document completeness",
    weight: 10,
    score: (facts) => linearScore(facts.documentCompleteness, { min: 0, max: 1 }),
  },
  {
    id: "valuation-confidence",
    label: "Extraction confidence",
    weight: 5,
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
 * Default LEDGERO risk model for receivable-pool assets. Fully
 * overridable via `mergeRiskModel` or by constructing your own
 * `RiskModel<ReceivableFacts>`.
 */
export const receivableRiskModel: RiskModel<ReceivableFacts> = {
  assetClass: "receivable",
  name: "Default receivable pool risk model",
  description: "Default LEDGERO risk model for receivable-pool assets.",
  factors: receivableFactors,
};
