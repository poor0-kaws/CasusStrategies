import type { Forecast } from "@casus/core";
import { describe, expect, it, vi } from "vitest";

import type { PredArenaAdapter } from "../src/adapters/predarena";
import { chooseEntrySide, ResearchPipeline } from "../src/pipeline";
import type { ResearchStore } from "../src/store/research-store";

const forecast: Forecast = {
  id: "forecast-1",
  marketId: "market-1",
  createdAt: "2026-08-07T12:00:00.000Z",
  informationCutoffAt: "2026-08-07T11:59:00.000Z",
  pointProbability: 0.5,
  lowerProbability: 0.46,
  upperProbability: 0.54,
  marketPrior: 0.5,
  likelihoodRatios: [1],
  modelFamily: "test",
  category: "weather",
};

describe("side-specific trade selection", () => {
  it("compares executable YES and NO asks instead of assuming complementary prices", () => {
    expect(chooseEntrySide(forecast, 0.45, 0.2)).toBe("no");
  });

  it("uses the available side when the other ask book is empty", () => {
    expect(chooseEntrySide(forecast, undefined, 0.4)).toBe("no");
    expect(chooseEntrySide(forecast, undefined, undefined)).toBeNull();
  });
});

describe("order reconciliation", () => {
  it("marks matching local and remote orders as reconciled", async () => {
    const appendReconciliation = vi.fn();
    const finalizeOrder = vi.fn();
    const setTradingFreeze = vi.fn();
    const pipeline = createReconciliationPipeline({
      localOrders: [
        { clientOrderId: "intent-1", predarenaOrderId: null, status: "execution_pending" },
      ],
      remoteOrders: [
        {
          orderId: "order-1",
          clientOrderId: "intent-1",
          strategy: "slow_value_v1",
          status: "executed",
          raw: { id: "order-1" },
        },
      ],
      appendReconciliation,
      finalizeOrder,
      setTradingFreeze,
    });

    await expect(pipeline.reconcile("test")).resolves.toMatchObject({ nav: 1_000 });
    expect(finalizeOrder).toHaveBeenCalledWith(
      expect.objectContaining({ clientOrderId: "intent-1", predarenaOrderId: "order-1" }),
    );
    expect(appendReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "matched" }),
    );
    expect(setTradingFreeze).toHaveBeenLastCalledWith(null, expect.any(String));
  });

  it("freezes trading when a pending local order is absent remotely", async () => {
    const appendReconciliation = vi.fn();
    const setTradingFreeze = vi.fn();
    const pipeline = createReconciliationPipeline({
      localOrders: [
        { clientOrderId: "intent-unknown", predarenaOrderId: null, status: "execution_pending" },
      ],
      remoteOrders: [],
      appendReconciliation,
      finalizeOrder: vi.fn(),
      setTradingFreeze,
    });

    await expect(pipeline.reconcile("unknown_order")).rejects.toThrow("reconciliation mismatch");
    expect(appendReconciliation).toHaveBeenCalledWith(
      expect.objectContaining({ status: "mismatch" }),
    );
    expect(setTradingFreeze).toHaveBeenCalledWith(
      expect.stringContaining("local_order_missing_remote"),
      expect.any(String),
    );
  });
});

function createReconciliationPipeline(input: {
  localOrders: Array<{ clientOrderId: string; predarenaOrderId: string | null; status: string }>;
  remoteOrders: Array<{
    orderId: string;
    clientOrderId: string | null;
    strategy: string | null;
    status: string;
    raw: Record<string, unknown>;
  }>;
  appendReconciliation: ReturnType<typeof vi.fn>;
  finalizeOrder: ReturnType<typeof vi.fn>;
  setTradingFreeze: ReturnType<typeof vi.fn>;
}) {
  const store = {
    listLocalOrders: vi.fn().mockResolvedValue(input.localOrders),
    finalizeOrder: input.finalizeOrder,
    appendRemoteFills: vi.fn(),
    appendPortfolioSnapshot: vi.fn(),
    appendReconciliation: input.appendReconciliation,
    setTradingFreeze: input.setTradingFreeze,
  } as unknown as ResearchStore;
  const predArena = {
    getPortfolio: vi.fn().mockResolvedValue({
      cash: 1_000,
      nav: 1_000,
      openExposure: 0,
      realizedPnl: 0,
      unrealizedPnl: 0,
      positions: [],
    }),
    getOrdersAndFills: vi.fn().mockResolvedValue({
      orders: input.remoteOrders,
      fills: [],
      raw: { orders: input.remoteOrders, fills: [] },
    }),
  } as unknown as PredArenaAdapter;

  return new ResearchPipeline({
    store,
    predArena,
    collector: {} as never,
    rules: {} as never,
    sources: {} as never,
    agents: {} as never,
    tradingMode: "shadow",
    now: () => new Date("2026-08-07T12:00:00.000Z"),
  });
}
