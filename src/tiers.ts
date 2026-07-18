import { RiskModelError, type RiskTier, type RiskTierThreshold } from "./types.js";

/**
 * Default tier ladder used by every built-in model unless a `RiskModel`
 * supplies its own `tierThresholds`. Fully overridable per model or per
 * call — see `mergeRiskModel` / custom `RiskModel` construction.
 */
export const defaultTierThresholds: RiskTierThreshold[] = [
  { tier: "low", minScore: 80 },
  { tier: "medium", minScore: 60 },
  { tier: "high", minScore: 40 },
  { tier: "critical", minScore: 0 },
];

/**
 * Resolve a 0-100 `score` into a `RiskTier` using `thresholds` (defaults
 * to `defaultTierThresholds`). Thresholds are matched by finding the
 * highest `minScore` that the score meets or exceeds; if the score is
 * below every threshold, the lowest-`minScore` tier is returned.
 */
export function resolveTier(
  score: number,
  thresholds: RiskTierThreshold[] = defaultTierThresholds,
): RiskTier {
  if (thresholds.length === 0) {
    throw new RiskModelError("resolveTier: `thresholds` must not be empty");
  }

  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  const match = sorted.find((t) => score >= t.minScore);
  return (match ?? sorted[sorted.length - 1]!).tier;
}
