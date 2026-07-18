import type { RiskFactor, RiskModel } from "../types.js";
import { inverseLinearScore, linearScore, stepScore } from "../scoring-utils.js";

/**
 * Structured facts about a single trade invoice, as would be produced by
 * the LEDGERO ingestion/extraction pipeline (OCR + cross-referenced
 * external data) before risk scoring.
 */
export interface InvoiceFacts {
  /** Face value of the invoice, in the underwriting currency. */
  invoiceAmount: number;
  /** Fraction (0-1) of the buyer's historical invoices paid on or before the due date. */
  buyerOnTimePaymentRatio: number;
  /** Days the invoice is currently past due (0 if not yet due, or paid on time). */
  daysPastDue: number;
  /** Fraction (0-1) of the buyer's total outstanding receivables represented by this single invoice. */
  buyerConcentration: number;
  /** Fraction (0-1) of required supporting documents (PO, delivery proof, tax invoice, etc.) present and verified. */
  documentCompleteness: number;
  /** Confidence (0-1) that OCR/extraction correctly captured the invoice's key fields and amount. */
  extractionConfidence: number;
  /** Externally sourced jurisdiction risk score for the buyer's jurisdiction, 0-100 (100 = safest). */
  jurisdictionRiskScore: number;
}

const invoiceFactors: RiskFactor<InvoiceFacts>[] = [
  {
    id: "payment-history",
    label: "Buyer payment history",
    description: "How reliably the buyer has paid past invoices on time.",
    weight: 25,
    score: (facts) => linearScore(facts.buyerOnTimePaymentRatio, { min: 0, max: 1 }),
  },
  {
    id: "delinquency",
    label: "Current delinquency",
    description: "Penalizes invoices that are already past due, with escalating severity.",
    weight: 20,
    score: (facts) =>
      stepScore(facts.daysPastDue, [
        { threshold: 0, score: 100 },
        { threshold: 15, score: 85 },
        { threshold: 30, score: 60 },
        { threshold: 60, score: 30 },
        { threshold: 90, score: 10 },
        { threshold: Number.POSITIVE_INFINITY, score: 0 },
      ]),
  },
  {
    id: "counterparty-concentration",
    label: "Counterparty concentration",
    description: "Penalizes heavy exposure to a single buyer.",
    weight: 15,
    score: (facts) => inverseLinearScore(facts.buyerConcentration, { min: 0, max: 1 }),
  },
  {
    id: "document-completeness",
    label: "Document completeness",
    description: "Rewards a fully documented invoice package.",
    weight: 15,
    score: (facts) => linearScore(facts.documentCompleteness, { min: 0, max: 1 }),
  },
  {
    id: "valuation-confidence",
    label: "Extraction confidence",
    description: "Confidence that OCR/extraction correctly captured the invoice's terms.",
    weight: 10,
    score: (facts) => linearScore(facts.extractionConfidence, { min: 0, max: 1 }),
  },
  {
    id: "jurisdiction-risk",
    label: "Jurisdiction risk",
    description: "Country/region risk for the buyer's jurisdiction.",
    weight: 15,
    score: (facts) => Math.min(100, Math.max(0, facts.jurisdictionRiskScore)),
  },
];

/**
 * Default LEDGERO risk model for trade invoice assets. Fully overridable
 * via `mergeRiskModel` or by constructing your own `RiskModel<InvoiceFacts>`.
 */
export const invoiceRiskModel: RiskModel<InvoiceFacts> = {
  assetClass: "invoice",
  name: "Default invoice risk model",
  description: "Default LEDGERO risk model for trade invoice assets.",
  factors: invoiceFactors,
};
