import type { RiskFactor, RiskModel } from "../types.js";
import { boolScore, linearScore, stepScore } from "../scoring-utils.js";

/**
 * Structured facts for a generic asset that does not fit a specific
 * asset class. Mirrors the minimal signal the LEDGERO dapp collects for
 * its catch-all `other` class: document completeness, whether a
 * counterparty is on record, and the claimed value. All fields have
 * safe, conservative interpretations so a thin file scores cautiously
 * rather than optimistically.
 */
export interface OtherFacts {
  /** Fraction (0-1) of required supporting documentation present and verified. */
  documentCompleteness: number;
  /** Whether a named counterparty is on record for the asset. */
  hasCounterparty: boolean;
  /** Claimed value of the asset, in the asset's currency. */
  claimedValue: number;
  /** Confidence (0-1) that extraction correctly captured the asset's figures. Defaults to 0.5 when omitted. */
  extractionConfidence?: number;
}

const otherFactors: RiskFactor<OtherFacts>[] = [
  {
    id: "document-completeness",
    label: "Document completeness",
    description:
      "Rewards a complete supporting file; a thin file for an unclassified asset is treated cautiously.",
    weight: 35,
    score: (facts) => linearScore(facts.documentCompleteness, { min: 0, max: 1 }),
  },
  {
    id: "counterparty-known",
    label: "Counterparty on record",
    description:
      "Rewards having an identified counterparty; anonymity raises risk for an asset with no class-specific signal.",
    weight: 30,
    score: (facts) => boolScore(facts.hasCounterparty, { trueScore: 100, falseScore: 40 }),
  },
  {
    id: "claimed-value",
    label: "Claimed value",
    description:
      "Larger claimed values carry more scrutiny weight for an unclassified asset, since there is no class-specific collateral signal to corroborate them.",
    weight: 20,
    score: (facts) =>
      stepScore(facts.claimedValue, [
        { threshold: 100_000, score: 100 },
        { threshold: 500_000, score: 85 },
        { threshold: 1_000_000, score: 70 },
        { threshold: 5_000_000, score: 50 },
        { threshold: Number.POSITIVE_INFINITY, score: 35 },
      ]),
  },
  {
    id: "valuation-confidence",
    label: "Extraction confidence",
    description: "Rewards high confidence that the asset's figures were captured correctly.",
    weight: 15,
    score: (facts) => linearScore(facts.extractionConfidence ?? 0.5, { min: 0, max: 1 }),
  },
];

/**
 * Default LEDGERO risk model for generic / unclassified (`other`) assets.
 *
 * Used as a safe fallback for assets that don't fit a specific asset
 * class. It relies only on class-agnostic signals (document completeness,
 * counterparty presence, claimed value, extraction confidence) and leans
 * conservative when data is missing. Fully overridable via
 * `mergeRiskModel` or by constructing your own `RiskModel<OtherFacts>`.
 */
export const otherRiskModel: RiskModel<OtherFacts> = {
  assetClass: "other",
  name: "Default generic (other) risk model",
  description:
    "Default LEDGERO risk model for generic assets that do not fit a specific asset class.",
  factors: otherFactors,
};
