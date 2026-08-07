import { describe, expect, it } from "vitest";

import { verifyRelationship, type ContractVersion } from "../src";

function contract(overrides: Partial<ContractVersion> = {}): ContractVersion {
  return {
    id: "contract-a",
    marketId: "market-a",
    ticker: "TEMP-80",
    venue: "kalshi",
    title: "Temperature above 80",
    question: "Will the temperature exceed 80?",
    yesCondition: "Official temperature exceeds 80F",
    noCondition: "Official temperature does not exceed 80F",
    deadline: "2026-08-08T23:59:59Z",
    resolutionSource: "NOAA",
    edgeCases: [],
    ambiguityScore: 0,
    contentHash: "hash-a",
    ruleVersion: "v1",
    observedAt: "2026-08-07T12:00:00Z",
    facts: {
      subjectKey: "nyc-temperature-2026-08-08",
      metricKey: "daily-high-temperature",
      outcomeKey: "above-80",
      thresholdOperator: "gt",
      thresholdValue: 80,
      unit: "fahrenheit",
      geographyKey: "KNYC",
    },
    ...overrides,
  };
}

describe("relationship verifier", () => {
  it("verifies a deterministic threshold implication", () => {
    const left = contract();
    const right = contract({
      id: "contract-b",
      marketId: "market-b",
      ticker: "TEMP-75",
      facts: { ...left.facts, outcomeKey: "above-75", thresholdValue: 75 },
    });

    expect(verifyRelationship({ kind: "requires", left, right }).verified).toBe(true);
  });

  it("rejects an implication across different official sources", () => {
    const left = contract();
    const right = contract({
      id: "contract-b",
      marketId: "market-b",
      resolutionSource: "Different source",
      facts: { ...left.facts, outcomeKey: "above-75", thresholdValue: 75 },
    });

    expect(verifyRelationship({ kind: "requires", left, right }).verified).toBe(false);
  });

  it("rejects threshold comparisons with different deadlines", () => {
    const left = contract();
    const right = contract({
      id: "contract-b",
      marketId: "market-b",
      deadline: "2026-08-09T23:59:59Z",
      facts: { ...left.facts, outcomeKey: "above-75", thresholdValue: 75 },
    });

    expect(verifyRelationship({ kind: "threshold_order", left, right }).verified).toBe(false);
  });

  it("does not call a basket exhaustive without a declared complete set", () => {
    const left = contract({
      facts: { ...contract().facts, outcomeKey: "yes", outcomeSetKey: "binary-event" },
    });
    const right = contract({
      id: "contract-b",
      marketId: "market-b",
      facts: { ...left.facts, outcomeKey: "no" },
    });

    expect(
      verifyRelationship({
        kind: "exhaustive",
        left,
        right,
        exhaustiveOutcomeKeys: ["yes", "maybe"],
      }).verified,
    ).toBe(false);
  });
});
