import { describe, expect, it } from "vitest";

import { calculateConservativeEdge, calculateQuarterKellySize } from "../src";

describe("trade math", () => {
  it("uses the lower bound for a YES trade", () => {
    const edge = calculateConservativeEdge({
      side: "yes",
      lowerYesProbability: 0.66,
      upperYesProbability: 0.75,
      executablePrice: 0.54,
      feePerContract: 0.01,
      simulationPenalty: 0.02,
    });

    expect(edge).toBeCloseTo(0.09);
  });

  it("uses one minus the upper YES bound for a NO trade", () => {
    const edge = calculateConservativeEdge({
      side: "no",
      lowerYesProbability: 0.2,
      upperYesProbability: 0.3,
      executablePrice: 0.58,
      feePerContract: 0.01,
      simulationPenalty: 0.01,
    });

    expect(edge).toBeCloseTo(0.1);
  });

  it("caps quarter-Kelly sizing by loss limit and visible depth", () => {
    const result = calculateQuarterKellySize({
      probability: 0.7,
      allInPrice: 0.5,
      nav: 1_000,
      maximumLoss: 10,
      visibleDepth: 100,
    });

    expect(result.fullKellyFraction).toBeCloseTo(0.4);
    expect(result.quarterKellyFraction).toBeCloseTo(0.1);
    expect(result.stake).toBe(10);
    expect(result.count).toBe(20);
  });

  it("returns no position when there is no edge", () => {
    expect(
      calculateQuarterKellySize({
        probability: 0.45,
        allInPrice: 0.5,
        nav: 1_000,
        maximumLoss: 10,
        visibleDepth: 100,
      }).count,
    ).toBe(0);
  });
});
