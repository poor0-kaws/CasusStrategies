import { describe, expect, it } from "vitest";

import { evaluateRisk, type RiskCheckInput, type TradeIntent } from "../src";

const intent: TradeIntent = {
  intentId: "intent-1",
  forecastId: "forecast-1",
  strategy: "slow_value_v1",
  category: "weather",
  venue: "kalshi",
  ticker: "WEATHER-NYC",
  relatedEventClusterId: "weather-nyc-2026-08-08",
  action: "buy",
  yesNo: "yes",
  count: 10,
  maximumPrice: 0.5,
  minimumNetEdge: 0.08,
  createdAt: "2026-08-07T12:00:00Z",
};

const validInput: RiskCheckInput = {
  intent,
  nav: 1_000,
  marketExposure: 0,
  clusterExposure: 0,
  totalOpenExposure: 0,
  ambiguityScore: 0.05,
  maximumAllowedAmbiguity: 0.2,
  visibleExitContracts: 20,
  closesAt: "2026-08-08T12:00:00Z",
  now: "2026-08-07T12:00:00Z",
  existingPositionCount: 0,
  newPositionsToday: 0,
  apiResponseKnown: true,
};

describe("risk gate", () => {
  it("approves an intent inside every limit", () => {
    expect(evaluateRisk(validInput)).toMatchObject({
      approved: true,
      proposedMaximumLoss: 5,
      reasons: [],
    });
  });

  it("reports every failed rule instead of hiding later failures", () => {
    const result = evaluateRisk({
      ...validInput,
      intent: { ...intent, count: 60 },
      ambiguityScore: 0.8,
      visibleExitContracts: 1,
      closesAt: "2026-08-07T13:00:00Z",
      existingPositionCount: 1,
      newPositionsToday: 2,
      apiResponseKnown: false,
    });

    expect(result.approved).toBe(false);
    expect(result.reasons).toContain("API response is unknown");
    expect(result.reasons).toContain("Contract rules are too ambiguous");
    expect(result.reasons).toContain("Per-market loss limit exceeded");
  });

  it("enforces gross, sector, and scenario loss independently", () => {
    const result = evaluateRisk({
      ...validInput,
      grossDeployed: 748,
      sectorExposure: 123,
      portfolioScenarioLoss: 248,
    });

    expect(result.approved).toBe(false);
    expect(result.reasons).toContain("Gross deployment limit exceeded");
    expect(result.reasons).toContain("Sector loss limit exceeded");
    expect(result.reasons).toContain("Portfolio scenario-loss limit exceeded");
  });
});
