import { describe, expect, it } from "vitest";
import { summarizePortfolio, type PortfolioEntry } from "../src/portfolio.js";
import { RiskModelError, type ScoreResult } from "../src/types.js";
import { toLetterGrade } from "../src/grade.js";

function makeResult(overallScore: number, tier: ScoreResult["tier"]): ScoreResult {
  return {
    assetClass: "invoice",
    overallScore,
    tier,
    letterGrade: toLetterGrade(overallScore),
    breakdown: [],
  };
}

describe("summarizePortfolio — basic aggregation", () => {
  it("throws on an empty portfolio", () => {
    expect(() => summarizePortfolio([])).toThrow(RiskModelError);
  });

  it("computes a simple unweighted average score when no exposure is given", () => {
    const entries: PortfolioEntry[] = [
      { result: makeResult(100, "low") },
      { result: makeResult(0, "critical") },
    ];
    const summary = summarizePortfolio(entries);
    expect(summary.averageScore).toBeCloseTo(50);
    // No exposure supplied -> defaults to 1 each -> weighted == unweighted.
    expect(summary.weightedAverageScore).toBeCloseTo(50);
    expect(summary.totalExposure).toBe(2);
    expect(summary.count).toBe(2);
  });

  it("computes an exposure-weighted average score distinct from the simple average", () => {
    const entries: PortfolioEntry[] = [
      { result: makeResult(100, "low"), exposure: 90 },
      { result: makeResult(0, "critical"), exposure: 10 },
    ];
    const summary = summarizePortfolio(entries);
    expect(summary.averageScore).toBeCloseTo(50);
    expect(summary.weightedAverageScore).toBeCloseTo(90);
  });

  it("throws on a negative exposure", () => {
    const entries: PortfolioEntry[] = [{ result: makeResult(50, "medium"), exposure: -5 }];
    expect(() => summarizePortfolio(entries)).toThrow(RiskModelError);
  });

  it("throws when worstN is not a non-negative integer", () => {
    const entries: PortfolioEntry[] = [{ result: makeResult(50, "medium") }];
    expect(() => summarizePortfolio(entries, { worstN: -1 })).toThrow(RiskModelError);
    expect(() => summarizePortfolio(entries, { worstN: 1.5 })).toThrow(RiskModelError);
  });

  it("falls back to the simple average as the weighted average when total exposure is zero", () => {
    const entries: PortfolioEntry[] = [
      { result: makeResult(80, "low"), exposure: 0 },
      { result: makeResult(20, "high"), exposure: 0 },
    ];
    const summary = summarizePortfolio(entries);
    expect(summary.totalExposure).toBe(0);
    expect(summary.weightedAverageScore).toBeCloseTo(summary.averageScore);
  });
});

describe("summarizePortfolio — tier distribution", () => {
  it("buckets entries by tier with count and exposure shares", () => {
    const entries: PortfolioEntry[] = [
      { result: makeResult(95, "low"), exposure: 100 },
      { result: makeResult(90, "low"), exposure: 100 },
      { result: makeResult(50, "high"), exposure: 300 },
      { result: makeResult(10, "critical"), exposure: 500 },
    ];
    const summary = summarizePortfolio(entries);

    const low = summary.tierDistribution.find((t) => t.tier === "low")!;
    expect(low.count).toBe(2);
    expect(low.countShare).toBeCloseTo(0.5);
    expect(low.exposure).toBe(200);
    expect(low.exposureShare).toBeCloseTo(0.2);

    const critical = summary.tierDistribution.find((t) => t.tier === "critical")!;
    expect(critical.count).toBe(1);
    expect(critical.exposureShare).toBeCloseTo(0.5);

    // Only tiers actually present are included, worst-to-best ordered.
    expect(summary.tierDistribution.map((t) => t.tier)).toEqual(["critical", "high", "low"]);
  });

  it("distribution's count and exposure shares sum to 1", () => {
    const entries: PortfolioEntry[] = [
      { result: makeResult(95, "low"), exposure: 40 },
      { result: makeResult(55, "medium"), exposure: 60 },
      { result: makeResult(15, "critical"), exposure: 20 },
    ];
    const summary = summarizePortfolio(entries);
    const countSum = summary.tierDistribution.reduce((s, t) => s + t.countShare, 0);
    const exposureSum = summary.tierDistribution.reduce((s, t) => s + t.exposureShare, 0);
    expect(countSum).toBeCloseTo(1);
    expect(exposureSum).toBeCloseTo(1);
  });
});

describe("summarizePortfolio — concentration (HHI)", () => {
  it("reports HHI of 1 when all exposure sits in a single group", () => {
    const entries: PortfolioEntry[] = [
      { result: makeResult(80, "low"), exposure: 100, groups: { counterparty: "acme" } },
      { result: makeResult(60, "medium"), exposure: 200, groups: { counterparty: "acme" } },
    ];
    const summary = summarizePortfolio(entries, { concentrationBy: ["counterparty"] });
    const c = summary.concentration.find((c) => c.groupKey === "counterparty")!;
    expect(c.hhi).toBeCloseTo(1);
    expect(c.groupCount).toBe(1);
    expect(c.largestGroup).toBe("acme");
    expect(c.largestGroupShare).toBeCloseTo(1);
  });

  it("reports low HHI for a fully diversified portfolio", () => {
    const entries: PortfolioEntry[] = [
      { result: makeResult(80, "low"), exposure: 100, groups: { counterparty: "a" } },
      { result: makeResult(80, "low"), exposure: 100, groups: { counterparty: "b" } },
      { result: makeResult(80, "low"), exposure: 100, groups: { counterparty: "c" } },
      { result: makeResult(80, "low"), exposure: 100, groups: { counterparty: "d" } },
    ];
    const summary = summarizePortfolio(entries, { concentrationBy: ["counterparty"] });
    const c = summary.concentration.find((c) => c.groupKey === "counterparty")!;
    // 4 equal groups of 0.25 share each -> HHI = 4 * 0.25^2 = 0.25 = 1/4
    expect(c.hhi).toBeCloseTo(0.25);
    expect(c.groupCount).toBe(4);
    expect(c.largestGroupShare).toBeCloseTo(0.25);
  });

  it("supports multiple concentration dimensions in one call", () => {
    const entries: PortfolioEntry[] = [
      {
        result: makeResult(80, "low"),
        exposure: 100,
        groups: { counterparty: "acme", assetClass: "invoice" },
      },
      {
        result: makeResult(60, "medium"),
        exposure: 100,
        groups: { counterparty: "globex", assetClass: "invoice" },
      },
    ];
    const summary = summarizePortfolio(entries, {
      concentrationBy: ["counterparty", "assetClass"],
    });
    expect(summary.concentration.map((c) => c.groupKey)).toEqual(["counterparty", "assetClass"]);
    const byAssetClass = summary.concentration.find((c) => c.groupKey === "assetClass")!;
    expect(byAssetClass.hhi).toBeCloseTo(1); // both entries share "invoice"
  });

  it("excludes entries missing the requested group key from that dimension", () => {
    const entries: PortfolioEntry[] = [
      { result: makeResult(80, "low"), exposure: 100, groups: { counterparty: "acme" } },
      { result: makeResult(60, "medium"), exposure: 100 }, // no groups at all
    ];
    const summary = summarizePortfolio(entries, { concentrationBy: ["counterparty"] });
    const c = summary.concentration.find((c) => c.groupKey === "counterparty")!;
    expect(c.groupCount).toBe(1);
    expect(c.breakdown[0]!.exposure).toBe(100);
  });

  it("returns an empty concentration array when concentrationBy is omitted", () => {
    const entries: PortfolioEntry[] = [{ result: makeResult(80, "low") }];
    const summary = summarizePortfolio(entries);
    expect(summary.concentration).toEqual([]);
  });
});

describe("summarizePortfolio — worst contributors", () => {
  it("returns the worstN lowest-scoring entries ascending by score", () => {
    const entries: PortfolioEntry[] = [
      { id: "a", result: makeResult(90, "low"), exposure: 10 },
      { id: "b", result: makeResult(10, "critical"), exposure: 20 },
      { id: "c", result: makeResult(50, "medium"), exposure: 30 },
      { id: "d", result: makeResult(30, "high"), exposure: 40 },
    ];
    const summary = summarizePortfolio(entries, { worstN: 2 });
    expect(summary.worstContributors.map((w) => w.id)).toEqual(["b", "d"]);
    expect(summary.worstContributors[0]!.exposureShare).toBeCloseTo(20 / 100);
  });

  it("defaults worstN to 5", () => {
    const entries: PortfolioEntry[] = Array.from({ length: 8 }, (_, i) => ({
      id: `e${i}`,
      result: makeResult(i * 10, "medium"),
    }));
    const summary = summarizePortfolio(entries);
    expect(summary.worstContributors.length).toBe(5);
  });

  it("caps worstN at the portfolio size", () => {
    const entries: PortfolioEntry[] = [
      { result: makeResult(90, "low") },
      { result: makeResult(10, "critical") },
    ];
    const summary = summarizePortfolio(entries, { worstN: 50 });
    expect(summary.worstContributors.length).toBe(2);
  });

  it("supports worstN of 0", () => {
    const entries: PortfolioEntry[] = [{ result: makeResult(90, "low") }];
    const summary = summarizePortfolio(entries, { worstN: 0 });
    expect(summary.worstContributors).toEqual([]);
  });
});
