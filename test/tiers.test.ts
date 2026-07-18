import { describe, expect, it } from "vitest";
import { defaultTierThresholds, resolveTier } from "../src/tiers.js";
import { RiskModelError } from "../src/types.js";

describe("defaultTierThresholds", () => {
  it("covers the full 0-100 range starting at 0", () => {
    const min = Math.min(...defaultTierThresholds.map((t) => t.minScore));
    expect(min).toBe(0);
  });
});

describe("resolveTier (default thresholds)", () => {
  it("classifies boundary and near-boundary scores correctly", () => {
    expect(resolveTier(100)).toBe("low");
    expect(resolveTier(80)).toBe("low");
    expect(resolveTier(79.999)).toBe("medium");
    expect(resolveTier(60)).toBe("medium");
    expect(resolveTier(59.999)).toBe("high");
    expect(resolveTier(40)).toBe("high");
    expect(resolveTier(39.999)).toBe("critical");
    expect(resolveTier(0)).toBe("critical");
  });
});

describe("resolveTier (custom thresholds)", () => {
  it("respects a caller-supplied tier ladder", () => {
    const thresholds = [
      { tier: "low" as const, minScore: 90 },
      { tier: "medium" as const, minScore: 70 },
      { tier: "high" as const, minScore: 50 },
      { tier: "critical" as const, minScore: 0 },
    ];

    expect(resolveTier(95, thresholds)).toBe("low");
    expect(resolveTier(90, thresholds)).toBe("low");
    expect(resolveTier(89, thresholds)).toBe("medium");
    expect(resolveTier(50, thresholds)).toBe("high");
    expect(resolveTier(10, thresholds)).toBe("critical");
  });

  it("does not require thresholds to be pre-sorted", () => {
    const shuffled = [
      { tier: "critical" as const, minScore: 0 },
      { tier: "low" as const, minScore: 80 },
      { tier: "high" as const, minScore: 40 },
      { tier: "medium" as const, minScore: 60 },
    ];
    expect(resolveTier(65, shuffled)).toBe("medium");
  });

  it("falls back to the lowest tier when score is below every threshold", () => {
    const thresholds = [
      { tier: "low" as const, minScore: 50 },
      { tier: "critical" as const, minScore: 20 },
    ];
    expect(resolveTier(0, thresholds)).toBe("critical");
  });

  it("throws when given an empty threshold list", () => {
    expect(() => resolveTier(50, [])).toThrow(RiskModelError);
  });
});
