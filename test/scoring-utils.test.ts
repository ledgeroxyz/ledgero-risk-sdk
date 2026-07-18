import { describe, expect, it } from "vitest";
import {
  boolScore,
  clampScore,
  inverseLinearScore,
  linearScore,
  stepScore,
} from "../src/scoring-utils.js";
import { RiskModelError } from "../src/types.js";

describe("clampScore", () => {
  it("passes through values already in [0, 100]", () => {
    expect(clampScore(0)).toBe(0);
    expect(clampScore(50)).toBe(50);
    expect(clampScore(100)).toBe(100);
  });

  it("clamps values above 100", () => {
    expect(clampScore(150)).toBe(100);
  });

  it("clamps values below 0", () => {
    expect(clampScore(-25)).toBe(0);
  });

  it("treats non-finite values as 0", () => {
    expect(clampScore(Number.NaN)).toBe(0);
    expect(clampScore(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampScore(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("linearScore", () => {
  it("maps min to 0 and max to 100", () => {
    expect(linearScore(0, { min: 0, max: 1 })).toBe(0);
    expect(linearScore(1, { min: 0, max: 1 })).toBe(100);
  });

  it("interpolates linearly between min and max", () => {
    expect(linearScore(0.25, { min: 0, max: 1 })).toBeCloseTo(25);
    expect(linearScore(5, { min: 0, max: 10 })).toBeCloseTo(50);
  });

  it("clamps values below min and above max", () => {
    expect(linearScore(-10, { min: 0, max: 10 })).toBe(0);
    expect(linearScore(20, { min: 0, max: 10 })).toBe(100);
  });

  it("handles Infinity input by clamping to max", () => {
    expect(linearScore(Number.POSITIVE_INFINITY, { min: 0, max: 2 })).toBe(100);
  });

  it("supports invert: higher raw value -> lower score", () => {
    expect(linearScore(0, { min: 0, max: 1, invert: true })).toBe(100);
    expect(linearScore(1, { min: 0, max: 1, invert: true })).toBe(0);
    expect(linearScore(0.25, { min: 0, max: 1, invert: true })).toBeCloseTo(75);
  });

  it("throws when min equals max", () => {
    expect(() => linearScore(5, { min: 3, max: 3 })).toThrow(RiskModelError);
  });

  it("throws when min or max is non-finite", () => {
    expect(() => linearScore(5, { min: 0, max: Number.POSITIVE_INFINITY })).toThrow(
      RiskModelError,
    );
  });
});

describe("inverseLinearScore", () => {
  it("is equivalent to linearScore with invert: true", () => {
    expect(inverseLinearScore(0.3, { min: 0, max: 1 })).toBe(
      linearScore(0.3, { min: 0, max: 1, invert: true }),
    );
  });
});

describe("stepScore", () => {
  const bands = [
    { threshold: 0, score: 100 },
    { threshold: 30, score: 60 },
    { threshold: 90, score: 0 },
  ];

  it("returns the score of the first band whose threshold is >= value", () => {
    expect(stepScore(0, bands)).toBe(100);
    expect(stepScore(15, bands)).toBe(60);
    expect(stepScore(30, bands)).toBe(60);
    expect(stepScore(45, bands)).toBe(0);
  });

  it("returns the last band's score when value exceeds every threshold", () => {
    expect(stepScore(1000, bands)).toBe(0);
  });

  it("does not require the caller to pre-sort bands", () => {
    const shuffled = [...bands].reverse();
    expect(stepScore(15, shuffled)).toBe(60);
  });

  it("clamps out-of-range band scores", () => {
    expect(stepScore(0, [{ threshold: 0, score: 150 }])).toBe(100);
    expect(stepScore(0, [{ threshold: 0, score: -10 }])).toBe(0);
  });

  it("throws on an empty step list", () => {
    expect(() => stepScore(10, [])).toThrow(RiskModelError);
  });
});

describe("boolScore", () => {
  it("returns trueScore when the condition is true", () => {
    expect(boolScore(true, { trueScore: 90, falseScore: 10 })).toBe(90);
  });

  it("returns falseScore when the condition is false", () => {
    expect(boolScore(false, { trueScore: 90, falseScore: 10 })).toBe(10);
  });

  it("clamps out-of-range scores", () => {
    expect(boolScore(true, { trueScore: 200, falseScore: -50 })).toBe(100);
    expect(boolScore(false, { trueScore: 200, falseScore: -50 })).toBe(0);
  });
});
