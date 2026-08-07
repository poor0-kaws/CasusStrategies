import type { Relationship } from "@casus/core";
import { describe, expect, it, vi } from "vitest";

import type { PredArenaAdapter } from "../src/adapters/predarena";
import type { CollectedMarket, PaperPortfolio, ParsedContract } from "../src/contracts";
import { findVerifiedHedgeCandidates, VerifiedHedgeExecutor } from "../src/hedge-execution";
import type { ResearchStore } from "../src/store/research-store";

const now = new Date("2026-08-07T12:00:00.000Z");
const portfolio: PaperPortfolio = {
  cash: 1_000,
  nav: 1_000,
  openExposure: 0,
  realizedPnl: 0,
  unrealizedPnl: 0,
  positions: [],
};

describe("verified two-leg hedges", () => {
  it("builds both offsetting choices for equivalent contracts", () => {
    const candidates = findVerifiedHedgeCandidates({
      relationships: [relationship],
      contracts: [leftContract, rightContract],
      markets: [leftMarket, rightMarket],
      now,
    });

    expect(candidates).toHaveLength(2);
    expect(candidates[0]).toMatchObject({ leftSide: "yes", rightSide: "no" });
  });

  it("unwinds the first leg and clears the freeze when the second FOK leg fails", async () => {
    let freeze: string | null = null;
    const planStatuses: string[] = [];
    const store = {
      getTradingFreeze: vi.fn(async () => freeze),
      setTradingFreeze: vi.fn(async (reason: string | null) => {
        freeze = reason;
      }),
      getSectorExposure: vi.fn(async () => 0),
      saveHedgePlan: vi.fn(),
      updateHedgePlanStatus: vi.fn(async (_id: string, status: string) => {
        planStatuses.push(status);
      }),
      appendDecisionRecord: vi.fn(),
      reserveOrderPlacements: vi.fn(async () => true),
      reserveRiskReducingOrder: vi.fn(async () => true),
      finalizeOrder: vi.fn(),
    } as unknown as ResearchStore;
    const submitOrder = vi
      .fn()
      .mockResolvedValueOnce(orderResult("left-fill", "filled", 0.4))
      .mockResolvedValueOnce(orderResult("right-reject", "rejected", 0.45))
      .mockResolvedValueOnce(orderResult("unwind-fill", "filled", 0.38));
    const predArena = {
      previewOrder: vi
        .fn()
        .mockResolvedValueOnce(preview(0.4, 8.8))
        .mockResolvedValueOnce(preview(0.45, 9.9))
        .mockResolvedValueOnce(preview(0.38, 0)),
      submitOrder,
    } as unknown as PredArenaAdapter;
    const reconcile = vi.fn(async () => portfolio);
    const candidate = findVerifiedHedgeCandidates({
      relationships: [relationship],
      contracts: [leftContract, rightContract],
      markets: [leftMarket, rightMarket],
      now,
    })[0]!;
    const executor = new VerifiedHedgeExecutor({
      store,
      predArena,
      tradingMode: "paper",
      reconcile,
      now: () => now,
    });

    await expect(executor.execute(candidate, portfolio, "2026-08-07")).resolves.toBe(0);
    expect(predArena.previewOrder).toHaveBeenCalledTimes(3);
    expect(submitOrder).toHaveBeenCalledTimes(3);
    expect(submitOrder.mock.calls[2]?.[0]).toMatchObject({
      action: "sell",
      timeInForce: "IOC",
      maximumPrice: 0.38,
    });
    expect(planStatuses).toContain("second_leg_failed");
    expect(planStatuses).toContain("unwound");
    expect(freeze).toBeNull();
  });
});

const relationship: Relationship = {
  id: "relationship-1",
  leftContractId: "contract-left",
  rightContractId: "contract-right",
  kind: "equivalent",
  explanation: "The structured facts and resolution rules match.",
  verificationStatus: "verified",
  confidence: 0.99,
  ruleVersion: "test",
  createdAt: now.toISOString(),
  reviewerStatus: "not_requested",
};

const commonFacts = {
  subjectKey: "new-york",
  metricKey: "temperature",
  outcomeKey: "above-80",
  thresholdOperator: "gt" as const,
  thresholdValue: 80,
  unit: "fahrenheit",
  geographyKey: "new-york",
};

const leftContract = contract("contract-left", "market-left", "LEFT");
const rightContract = contract("contract-right", "market-right", "RIGHT");
const leftMarket = market("market-left", "LEFT", 0.4, 0.62);
const rightMarket = market("market-right", "RIGHT", 0.43, 0.45);

function contract(id: string, marketId: string, ticker: string): ParsedContract {
  return {
    id,
    marketId,
    ticker,
    venue: "kalshi",
    title: "Will New York exceed 80 degrees?",
    question: "Will New York exceed 80 degrees?",
    yesCondition: "The temperature exceeds 80 degrees.",
    noCondition: "The temperature does not exceed 80 degrees.",
    deadline: "2026-08-09T12:00:00.000Z",
    resolutionSource: "https://api.weather.gov/test",
    edgeCases: [],
    ambiguityScore: 0.05,
    contentHash: `hash-${id}`,
    ruleVersion: "test",
    observedAt: now.toISOString(),
    storedAt: now.toISOString(),
    exactRules: "Official temperature observation.",
    facts: commonFacts,
  };
}

function market(
  marketId: string,
  ticker: string,
  yesPrice: number,
  noPrice: number,
): CollectedMarket {
  return {
    marketId,
    ticker,
    venue: "kalshi",
    title: "Will New York exceed 80 degrees?",
    closesAt: "2026-08-09T12:00:00.000Z",
    displayedPrice: yesPrice,
    volume: 1_000,
    liquidity: 1_000,
    minimumOrderSize: 1,
    minimumTickSize: 0.01,
    yesAsks: [{ price: yesPrice, quantity: 100 }],
    noAsks: [{ price: noPrice, quantity: 100 }],
    yesBids: [{ price: yesPrice - 0.01, quantity: 100 }],
    noBids: [{ price: noPrice - 0.01, quantity: 100 }],
    fees: {},
    rawResponseHash: `book-${marketId}`,
    observedAt: now.toISOString(),
    storedAt: now.toISOString(),
  };
}

function preview(averagePrice: number, requiredCash: number) {
  return {
    previewId: `preview-${averagePrice}`,
    status: "accepted" as const,
    averagePrice,
    fees: 0,
    requiredCash,
    raw: { averagePrice, requiredCash },
  };
}

function orderResult(orderId: string, status: string, averagePrice: number) {
  return {
    orderId,
    clientOrderId: orderId,
    status,
    averagePrice,
    fees: 0,
    raw: { orderId, status },
  };
}
