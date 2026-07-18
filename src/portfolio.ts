/**
 * Portfolio-level risk aggregation over a collection of already-scored
 * assets. Everything here operates purely on `ScoreResult`s (plus
 * caller-supplied weights/grouping) — it has no dependency on how those
 * results were produced, so it works equally well across asset classes
 * and custom models.
 */

import type { RiskTier, ScoreResult } from "./types.js";
import { RiskModelError } from "./types.js";

/**
 * One entry in a portfolio: a scored asset plus optional portfolio-level
 * metadata used for weighting and concentration analysis.
 */
export interface PortfolioEntry {
  /** The individual asset's scoring result. */
  result: ScoreResult;
  /**
   * Exposure amount (e.g. principal, face value, outstanding balance) used
   * to weight this asset in portfolio-level aggregates. Defaults to `1`
   * (i.e. an equal-weighted / unweighted portfolio) when omitted.
   */
  exposure?: number;
  /**
   * Arbitrary caller-supplied identifier for this entry (e.g. asset id),
   * echoed back in `worstContributors` for traceability.
   */
  id?: string;
  /**
   * Grouping key(s) used for concentration analysis (e.g. counterparty
   * name, asset class, jurisdiction). A single entry may belong to more
   * than one grouping dimension — see `concentration` in
   * `PortfolioSummaryOptions`.
   */
  groups?: Record<string, string>;
}

/** Histogram of how much exposure/count falls into each risk tier. */
export interface TierDistributionEntry {
  tier: RiskTier;
  /** Number of entries classified into this tier. */
  count: number;
  /** Fraction (0-1) of entries (by count) classified into this tier. */
  countShare: number;
  /** Total exposure classified into this tier. */
  exposure: number;
  /** Fraction (0-1) of total exposure classified into this tier. */
  exposureShare: number;
}

/** Concentration analysis for a single grouping dimension. */
export interface ConcentrationResult {
  /** The grouping dimension this result describes (e.g. "counterparty"). */
  groupKey: string;
  /**
   * Herfindahl-Hirschman Index (HHI) of exposure share across groups,
   * on a 0-1 scale (sum of squared exposure shares). `1 / groupCount` is
   * the fully diversified floor; `1` means all exposure sits in a single
   * group. Multiply by 10,000 to get the conventional 0-10,000 HHI scale
   * used in antitrust/credit-risk literature.
   */
  hhi: number;
  /** Number of distinct groups observed for this dimension. */
  groupCount: number;
  /** Exposure share (0-1) held by the single largest group. */
  largestGroupShare: number;
  /** The largest group's key, or `undefined` if there was no exposure. */
  largestGroup?: string;
  /** Per-group exposure breakdown, sorted by descending exposure share. */
  breakdown: Array<{ group: string; exposure: number; share: number }>;
}

/** A single entry in the worst-N contributors list. */
export interface WorstContributor {
  id?: string;
  overallScore: number;
  tier: RiskTier;
  exposure: number;
  /** This entry's exposure as a fraction (0-1) of total portfolio exposure. */
  exposureShare: number;
}

export interface PortfolioSummaryOptions {
  /**
   * Grouping dimension names (matching keys in each entry's `groups`) to
   * run concentration analysis over. Entries missing a given group key
   * are excluded from that dimension's concentration result.
   */
  concentrationBy?: string[];
  /** How many of the worst-scoring entries to surface. Defaults to `5`. */
  worstN?: number;
}

/** Portfolio-level aggregation over a set of scored assets. */
export interface PortfolioSummary {
  /** Number of entries in the portfolio. */
  count: number;
  /** Sum of all entries' exposure. */
  totalExposure: number;
  /** Simple (unweighted) mean of `overallScore` across entries. */
  averageScore: number;
  /** Exposure-weighted mean of `overallScore` across entries. */
  weightedAverageScore: number;
  /** Tier histogram, one entry per tier present in the portfolio, sorted worst-to-best. */
  tierDistribution: TierDistributionEntry[];
  /** Concentration analysis per requested grouping dimension. */
  concentration: ConcentrationResult[];
  /** The `worstN` lowest-scoring entries, sorted ascending by score. */
  worstContributors: WorstContributor[];
}

const TIER_ORDER: RiskTier[] = ["critical", "high", "medium", "low"];

/**
 * Compute portfolio-level risk metrics from a set of already-scored
 * assets: exposure-weighted average score, a tier distribution/histogram,
 * concentration risk (HHI-style) over one or more caller-supplied
 * grouping dimensions, and the worst-N contributors by score.
 *
 * Purely a post-processing step over `ScoreResult`s — it does not call
 * into the scoring engine itself, so it works for any mix of asset
 * classes or custom models.
 */
export function summarizePortfolio(
  entries: PortfolioEntry[],
  options: PortfolioSummaryOptions = {},
): PortfolioSummary {
  if (entries.length === 0) {
    throw new RiskModelError("summarizePortfolio: `entries` must not be empty.");
  }

  const worstN = options.worstN ?? 5;
  if (!Number.isInteger(worstN) || worstN < 0) {
    throw new RiskModelError("summarizePortfolio: `worstN` must be a non-negative integer.");
  }

  const normalized = entries.map((entry) => {
    const exposure = entry.exposure ?? 1;
    if (!Number.isFinite(exposure) || exposure < 0) {
      throw new RiskModelError(
        `summarizePortfolio: entry${entry.id ? ` "${entry.id}"` : ""} has an invalid exposure (must be a finite number >= 0).`,
      );
    }
    return { ...entry, exposure };
  });

  const totalExposure = normalized.reduce((sum, e) => sum + e.exposure, 0);

  const averageScore =
    normalized.reduce((sum, e) => sum + e.result.overallScore, 0) / normalized.length;

  const weightedAverageScore =
    totalExposure > 0
      ? normalized.reduce((sum, e) => sum + e.result.overallScore * e.exposure, 0) / totalExposure
      : averageScore;

  // Tier distribution
  const tierBuckets = new Map<RiskTier, { count: number; exposure: number }>();
  for (const entry of normalized) {
    const bucket = tierBuckets.get(entry.result.tier) ?? { count: 0, exposure: 0 };
    bucket.count += 1;
    bucket.exposure += entry.exposure;
    tierBuckets.set(entry.result.tier, bucket);
  }
  const tierDistribution: TierDistributionEntry[] = TIER_ORDER.filter((tier) =>
    tierBuckets.has(tier),
  ).map((tier) => {
    const bucket = tierBuckets.get(tier)!;
    return {
      tier,
      count: bucket.count,
      countShare: bucket.count / normalized.length,
      exposure: bucket.exposure,
      exposureShare: totalExposure > 0 ? bucket.exposure / totalExposure : 0,
    };
  });

  // Concentration analysis
  const concentration: ConcentrationResult[] = (options.concentrationBy ?? []).map((groupKey) =>
    computeConcentration(groupKey, normalized),
  );

  // Worst-N contributors
  const worstContributors: WorstContributor[] = [...normalized]
    .sort((a, b) => a.result.overallScore - b.result.overallScore)
    .slice(0, worstN)
    .map((entry) => ({
      id: entry.id,
      overallScore: entry.result.overallScore,
      tier: entry.result.tier,
      exposure: entry.exposure,
      exposureShare: totalExposure > 0 ? entry.exposure / totalExposure : 0,
    }));

  return {
    count: normalized.length,
    totalExposure,
    averageScore,
    weightedAverageScore,
    tierDistribution,
    concentration,
    worstContributors,
  };
}

function computeConcentration(
  groupKey: string,
  entries: Array<PortfolioEntry & { exposure: number }>,
): ConcentrationResult {
  const groupExposure = new Map<string, number>();
  let groupedExposure = 0;

  for (const entry of entries) {
    const group = entry.groups?.[groupKey];
    if (group === undefined) continue;
    groupExposure.set(group, (groupExposure.get(group) ?? 0) + entry.exposure);
    groupedExposure += entry.exposure;
  }

  const breakdown = [...groupExposure.entries()]
    .map(([group, exposure]) => ({
      group,
      exposure,
      share: groupedExposure > 0 ? exposure / groupedExposure : 0,
    }))
    .sort((a, b) => b.exposure - a.exposure);

  const hhi = breakdown.reduce((sum, g) => sum + g.share * g.share, 0);
  const largest = breakdown[0];

  return {
    groupKey,
    hhi,
    groupCount: breakdown.length,
    largestGroupShare: largest?.share ?? 0,
    largestGroup: largest?.group,
    breakdown,
  };
}
