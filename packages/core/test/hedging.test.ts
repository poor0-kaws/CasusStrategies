import { describe, expect, it } from "vitest";

import { calculateScenarioRisk, evaluateTwoLegHedge, type ScenarioPosition } from "../src";

describe("deterministic scenario risk", () => {
  it("recognizes an offsetting pair only when its relationship is verified", () => {
    const positions: ScenarioPosition[] = [
      { marketId: "a", side: "yes", count: 10, price: 0.45, fees: 0 },
      { marketId: "b", side: "no", count: 10, price: 0.45, fees: 0 },
    ];
    const verified = calculateScenarioRisk(positions, [
      {
        leftMarketId: "a",
        rightMarketId: "b",
        kind: "equivalent",
        verificationStatus: "verified",
      },
    ]);
    const unverified = calculateScenarioRisk(positions, [
      {
        leftMarketId: "a",
        rightMarketId: "b",
        kind: "equivalent",
        verificationStatus: "unverified",
      },
    ]);

    expect(verified.worstCaseLoss).toBe(0);
    expect(verified.scenarios).toHaveLength(2);
    expect(unverified.worstCaseLoss).toBe(9);
    expect(unverified.scenarios).toHaveLength(4);
  });

  it("models implication and mutually exclusive outcomes", () => {
    const positions: ScenarioPosition[] = [
      { marketId: "champion", side: "yes", count: 1, price: 0.2, fees: 0 },
      { marketId: "final", side: "yes", count: 1, price: 0.4, fees: 0 },
    ];
    const result = calculateScenarioRisk(positions, [
      {
        leftMarketId: "champion",
        rightMarketId: "final",
        kind: "requires",
        verificationStatus: "verified",
      },
    ]);

    expect(result.scenarios.map((scenario) => scenario.outcomes)).not.toContainEqual({
      champion: true,
      final: false,
    });
  });

  it("rejects clusters too large to enumerate safely", () => {
    const positions = Array.from({ length: 9 }, (_, index) => ({
      marketId: `market-${index}`,
      side: "yes" as const,
      count: 1,
      price: 0.5,
      fees: 0,
    }));

    expect(() => calculateScenarioRisk(positions, [])).toThrow("at most 8 markets");
  });

  it("approves a verified two-leg pair with bounded orphan risk", () => {
    const result = evaluateTwoLegHedge({
      nav: 1_000,
      existingPositions: [],
      hedgeLegs: [
        { marketId: "a", side: "yes", count: 10, price: 0.44, fees: 0 },
        { marketId: "b", side: "no", count: 10, price: 0.5, fees: 0 },
      ],
      relationships: [
        {
          leftMarketId: "a",
          rightMarketId: "b",
          kind: "equivalent",
          verificationStatus: "verified",
        },
      ],
      combinedNetEdge: 0.06,
      purpose: "new_pair",
    });

    expect(result.approved).toBe(true);
    expect(result.postHedgeScenarioLoss).toBe(0);
    expect(result.maximumOrphanLoss).toBeLessThanOrEqual(10);
  });
});
