import { describe, expect, it } from "vitest";

import {
  applyLikelihoodRatio,
  combineProbabilitiesInLogOdds,
  shrinkProbabilityTowardMarket,
} from "../src";

describe("probability math", () => {
  it("turns a 40% prior and 2x evidence into about 57.1%", () => {
    expect(applyLikelihoodRatio(0.4, 2)).toBeCloseTo(0.571_428, 5);
  });

  it("combines independent estimates in log-odds space", () => {
    const combined = combineProbabilitiesInLogOdds([{ probability: 0.6 }, { probability: 0.8 }]);

    expect(combined).toBeCloseTo(0.710_102, 5);
  });

  it("shrinks a forecast toward the market", () => {
    const result = shrinkProbabilityTowardMarket(0.7, 0.5, 0.5);

    expect(result).toBeGreaterThan(0.5);
    expect(result).toBeLessThan(0.7);
  });
});
