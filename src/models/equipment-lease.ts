import type { RiskFactor, RiskModel } from "../types.js";
import { boolScore, linearScore, stepScore } from "../scoring-utils.js";

/**
 * Structured facts about a single equipment lease (or a pool of leases)
 * being underwritten for tokenization.
 */
export interface EquipmentLeaseFacts {
  /** Current appraised/book value of the leased equipment. */
  equipmentValue: number;
  /** Estimated remaining useful life of the equipment, in years. */
  remainingUsefulLifeYears: number;
  /** Number of consecutive months the lessee is currently in arrears on lease payments. */
  monthsInArrears: number;
  /** Fraction (0-1) of the equipment's rated capacity currently in productive use. */
  utilizationRatio: number;
  /** Whether the equipment is up to date on required maintenance/inspection schedules. */
  maintenanceCompliant: boolean;
  /** Externally sourced creditworthiness score for the lessee, 0-100 (100 = strongest). */
  lesseeCreditScore: number;
  /** Fraction (0-1) of required supporting documentation present and verified. */
  documentCompleteness: number;
  /** Confidence (0-1) that the appraisal/extraction correctly captured the lease's key figures. */
  extractionConfidence: number;
  /** Externally sourced jurisdiction risk score, 0-100 (100 = safest). */
  jurisdictionRiskScore: number;
}

const equipmentLeaseFactors: RiskFactor<EquipmentLeaseFacts>[] = [
  {
    id: "remaining-useful-life",
    label: "Remaining useful life",
    description: "Rewards equipment with more remaining productive life relative to the lease term.",
    weight: 20,
    score: (facts) => linearScore(facts.remainingUsefulLifeYears, { min: 0, max: 10 }),
  },
  {
    id: "arrears",
    label: "Lease payment arrears",
    description: "Penalizes lessees currently behind on lease payments, with escalating severity.",
    weight: 20,
    score: (facts) =>
      stepScore(facts.monthsInArrears, [
        { threshold: 0, score: 100 },
        { threshold: 1, score: 70 },
        { threshold: 3, score: 30 },
        { threshold: Number.POSITIVE_INFINITY, score: 0 },
      ]),
  },
  {
    id: "lessee-creditworthiness",
    label: "Lessee creditworthiness",
    description: "Externally sourced credit strength of the lessee.",
    weight: 15,
    score: (facts) => linearScore(facts.lesseeCreditScore, { min: 0, max: 100 }),
  },
  {
    id: "utilization",
    label: "Utilization ratio",
    description: "Rewards equipment in active productive use over idle equipment.",
    weight: 15,
    score: (facts) => linearScore(facts.utilizationRatio, { min: 0, max: 1 }),
  },
  {
    id: "maintenance-compliance",
    label: "Maintenance compliance",
    description: "Penalizes equipment that has fallen behind on required maintenance/inspection.",
    weight: 10,
    score: (facts) => boolScore(facts.maintenanceCompliant, { trueScore: 100, falseScore: 20 }),
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
    weight: 5,
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
 * Default LEDGERO risk model for equipment lease assets. Fully
 * overridable via `mergeRiskModel` or by constructing your own
 * `RiskModel<EquipmentLeaseFacts>`.
 */
export const equipmentLeaseRiskModel: RiskModel<EquipmentLeaseFacts> = {
  assetClass: "equipment-lease",
  name: "Default equipment lease risk model",
  description: "Default LEDGERO risk model for equipment lease assets.",
  factors: equipmentLeaseFactors,
};
