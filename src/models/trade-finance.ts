import type { RiskFactor, RiskModel } from "../types.js";
import { inverseLinearScore, linearScore, stepScore } from "../scoring-utils.js";

/**
 * Structured facts about a trade finance instrument (e.g. a letter of
 * credit, export/import financing facility) being underwritten for
 * tokenization.
 */
export interface TradeFinanceFacts {
  /** Face value of the instrument, in the underwriting currency. */
  instrumentAmount: number;
  /** Credit strength of the issuing/confirming bank, 0-100 (100 = strongest). */
  issuingBankCreditRating: number;
  /** Number of documentary discrepancies flagged during document examination. */
  discrepancyCount: number;
  /** Days remaining until the instrument's maturity/expiry date. */
  daysToMaturity: number;
  /** Fraction (0-1) of total exposure concentrated in this single counterparty/bank. */
  counterpartyConcentration: number;
  /** Fraction (0-1) of required supporting trade documentation present and verified. */
  documentCompleteness: number;
  /** Confidence (0-1) that OCR/extraction correctly captured the instrument's key terms. */
  extractionConfidence: number;
  /** Externally sourced jurisdiction risk score for the issuing bank's jurisdiction, 0-100 (100 = safest). */
  jurisdictionRiskScore: number;
}

const tradeFinanceFactors: RiskFactor<TradeFinanceFacts>[] = [
  {
    id: "issuing-bank-strength",
    label: "Issuing bank credit strength",
    description: "Credit strength of the issuing/confirming bank backing the instrument.",
    weight: 25,
    score: (facts) => linearScore(facts.issuingBankCreditRating, { min: 0, max: 100 }),
  },
  {
    id: "documentary-discrepancies",
    label: "Documentary discrepancies",
    description: "Penalizes instruments with document-examination discrepancies, which delay or block payment.",
    weight: 20,
    score: (facts) => inverseLinearScore(facts.discrepancyCount, { min: 0, max: 10 }),
  },
  {
    id: "tenor-risk",
    label: "Tenor / time-to-maturity risk",
    description: "Penalizes longer-dated instruments, which carry more time for conditions to deteriorate.",
    weight: 15,
    score: (facts) =>
      stepScore(facts.daysToMaturity, [
        { threshold: 30, score: 100 },
        { threshold: 60, score: 85 },
        { threshold: 90, score: 65 },
        { threshold: 180, score: 40 },
        { threshold: Number.POSITIVE_INFINITY, score: 20 },
      ]),
  },
  {
    id: "counterparty-concentration",
    label: "Counterparty concentration",
    description: "Penalizes heavy exposure to a single bank/counterparty.",
    weight: 15,
    score: (facts) => inverseLinearScore(facts.counterpartyConcentration, { min: 0, max: 1 }),
  },
  {
    id: "document-completeness",
    label: "Document completeness",
    description: "Rewards a fully documented trade finance package.",
    weight: 10,
    score: (facts) => linearScore(facts.documentCompleteness, { min: 0, max: 1 }),
  },
  {
    id: "valuation-confidence",
    label: "Extraction confidence",
    description: "Confidence that OCR/extraction correctly captured the instrument's terms.",
    weight: 5,
    score: (facts) => linearScore(facts.extractionConfidence, { min: 0, max: 1 }),
  },
  {
    id: "jurisdiction-risk",
    label: "Jurisdiction risk",
    description: "Country/region risk for the issuing bank's jurisdiction.",
    weight: 10,
    score: (facts) => Math.min(100, Math.max(0, facts.jurisdictionRiskScore)),
  },
];

/**
 * Default LEDGERO risk model for trade finance instrument assets (e.g.
 * letters of credit, export/import financing). Fully overridable via
 * `mergeRiskModel` or by constructing your own
 * `RiskModel<TradeFinanceFacts>`.
 */
export const tradeFinanceRiskModel: RiskModel<TradeFinanceFacts> = {
  assetClass: "trade-finance",
  name: "Default trade finance risk model",
  description: "Default LEDGERO risk model for trade finance instrument assets.",
  factors: tradeFinanceFactors,
};
