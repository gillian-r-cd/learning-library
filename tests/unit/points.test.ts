import { describe, it, expect } from "vitest";
import {
  computePoints,
  retrievability,
  effectivePoints,
  updateStability,
  initialStability,
  daysBetween,
  computeUnlockThresholds,
} from "@/lib/points";

describe("computePoints", () => {
  it("scales by complexity multiplier", () => {
    expect(computePoints({ grades: ["good"], complexity: "low" })).toBeCloseTo(3.0);
    expect(computePoints({ grades: ["good"], complexity: "medium" })).toBeCloseTo(4.5);
    expect(computePoints({ grades: ["good"], complexity: "high" })).toBeCloseTo(7.5);
  });
  it("sums base points across grades", () => {
    expect(computePoints({ grades: ["good", "medium", "poor"], complexity: "low" })).toBeCloseTo(4);
    expect(computePoints({ grades: ["medium", "medium"], complexity: "medium" })).toBeCloseTo(3);
  });
  it("handles empty grades", () => {
    expect(computePoints({ grades: [], complexity: "high" })).toBe(0);
  });
});

describe("retrievability (FSRS-inspired)", () => {
  it("is 1.0 at t=0 (no decay)", () => {
    expect(retrievability(10, 0)).toBeCloseTo(1.0, 5);
  });
  it("decays monotonically over time", () => {
    const r1 = retrievability(10, 5);
    const r2 = retrievability(10, 20);
    expect(r1).toBeGreaterThan(r2);
  });
  it("floors at floorRatio", () => {
    const r = retrievability(1, 1000, 0.2);
    expect(r).toBeCloseTo(0.2, 5);
  });
  it("procedural knowledge decays slower than factual (via stability)", () => {
    // same elapsed days, bigger stability → higher retrievability
    expect(retrievability(14, 7)).toBeGreaterThan(retrievability(3, 7));
  });
});

describe("effectivePoints", () => {
  it("multiplies raw by retrievability", () => {
    const e = effectivePoints({ raw: 10, stabilityDays: 10, elapsedDays: 0 });
    expect(e).toBeCloseTo(10);
  });
});

describe("updateStability", () => {
  it("grows with good grade", () => {
    const s = updateStability({ oldStability: 10, grade: "good", knowledgeType: "procedural" });
    expect(s).toBeGreaterThan(10);
  });
  it("shrinks relative to good for poor grade", () => {
    const g = updateStability({ oldStability: 10, grade: "good", knowledgeType: "procedural" });
    const p = updateStability({ oldStability: 10, grade: "poor", knowledgeType: "procedural" });
    expect(g).toBeGreaterThan(p);
  });
});

describe("initialStability", () => {
  it("procedural > conceptual > factual", () => {
    expect(initialStability("procedural")).toBeGreaterThan(initialStability("conceptual"));
    expect(initialStability("conceptual")).toBeGreaterThan(initialStability("factual"));
  });
});

describe("daysBetween", () => {
  it("returns 0 when either ts is null", () => {
    expect(daysBetween(null, "2026-04-22T00:00:00Z")).toBe(0);
  });
  it("computes fractional days", () => {
    const d = daysBetween("2026-04-21T00:00:00Z", "2026-04-22T12:00:00Z");
    expect(d).toBeCloseTo(1.5, 3);
  });
});

describe("computeUnlockThresholds", () => {
  it("spreads thresholds across capacity in ascending order", () => {
    const ts = computeUnlockThresholds(["cp1", "cp2", "cp3"], 100);
    expect(ts).toHaveLength(3);
    expect(ts[0].threshold).toBeLessThan(ts[1].threshold);
    expect(ts[1].threshold).toBeLessThan(ts[2].threshold);
  });
  it("handles empty list", () => {
    expect(computeUnlockThresholds([], 100)).toEqual([]);
  });
});
