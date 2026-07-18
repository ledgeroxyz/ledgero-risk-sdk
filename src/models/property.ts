import type { RiskFactor, RiskModel } from "../types.js";
import { boolScore, linearScore, stepScore } from "../scoring-utils.js";

/**
 * Structured facts about a real-estate/property asset being underwritten
 * for tokenization.
 */
export interface PropertyFacts {
  /** Most recent independent appraisal value. */
  appraisedValue: number;
  /** Outstanding financing/lien amount secured against the property. */
  outstandingLoanAmount: number;
  /** Property age in years. */
  propertyAgeYears: number;
  /** Fraction (0-1) of the property's leasable/usable space currently occupied. */
  occupancyRatio: number;
  /** Whether title search flagged unresolved defects (liens, disputes, etc.). */
  titleDefects: boolean;
  /** Fraction (0-1) of required supporting documentation present and verified. */
  documentCompleteness: number;
  /** Confidence (0-1) that the appraisal/extraction correctly captured the property's key figures. */
  extractionConfidence: number;
  /** Externally sourced jurisdiction risk score, 0-100 (100 = safest). */
  jurisdictionRiskScore: number;
}

const propertyFactors: RiskFactor<PropertyFacts>[] = [
  {
    id: "collateral-coverage",
    label: "Collateral coverage ratio",
    description:
      "Appraised value relative to outstanding financing (inverse of loan-to-value); higher coverage means more equity cushion.",
    weight: 30,
    score: (facts) => {
      const ratio =
        facts.outstandingLoanAmount > 0
          ? facts.appraisedValue / facts.outstandingLoanAmount
          : Number.POSITIVE_INFINITY;
      return linearScore(ratio, { min: 0, max: 2 });
    },
  },
  {
    id: "asset-age",
    label: "Property age / depreciation",
    description: "Penalizes older properties, which typically carry higher maintenance and obsolescence risk.",
    weight: 15,
    score: (facts) =>
      stepScore(facts.propertyAgeYears, [
        { threshold: 5, score: 100 },
        { threshold: 15, score: 90 },
        { threshold: 30, score: 75 },
        { threshold: 50, score: 55 },
        { threshold: 80, score: 35 },
        { threshold: Number.POSITIVE_INFINITY, score: 20 },
      ]),
  },
  {
    id: "occupancy",
    label: "Occupancy ratio",
    description: "Rewards higher occupancy as a proxy for income stability and demand.",
    weight: 15,
    score: (facts) => linearScore(facts.occupancyRatio, { min: 0, max: 1 }),
  },
  {
    id: "title-defects",
    label: "Title defects",
    description: "Heavily penalizes unresolved title issues (liens, ownership disputes, etc.).",
    weight: 15,
    score: (facts) => boolScore(facts.titleDefects, { trueScore: 0, falseScore: 100 }),
  },
  {
    id: "document-completeness",
    label: "Document completeness",
    weight: 10,
    score: (facts) => linearScore(facts.documentCompleteness, { min: 0, max: 1 }),
  },
  {
    id: "valuation-confidence",
    label: "Appraisal/extraction confidence",
    weight: 10,
    score: (facts) => linearScore(facts.extractionConfidence, { min: 0, max: 1 }),
  },
  {
    id: "jurisdiction-risk",
    label: "Jurisdiction risk",
    weight: 5,
    score: (facts) => Math.min(100, Math.max(0, facts.jurisdictionRiskScore)),
  },
];

/**
 * Default LEDGERO risk model for property assets. Fully overridable via
 * `mergeRiskModel` or by constructing your own `RiskModel<PropertyFacts>`.
 */
export const propertyRiskModel: RiskModel<PropertyFacts> = {
  assetClass: "property",
  name: "Default property risk model",
  description: "Default LEDGERO risk model for real-estate/property assets.",
  factors: propertyFactors,
};
