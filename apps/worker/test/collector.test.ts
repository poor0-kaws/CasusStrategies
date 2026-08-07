import { describe, expect, it, vi } from "vitest";

import type { PredArenaAdapter } from "../src/adapters/predarena";
import { PointInTimeCollector } from "../src/collector";
import type { ResearchStore } from "../src/store/research-store";

describe("PointInTimeCollector", () => {
  it("keeps only ten book levels and records observation time", async () => {
    const levels = Array.from({ length: 12 }, (_, index) => ({ price: 0.4, quantity: index + 1 }));
    const predArena = {
      getOrderBook: vi.fn().mockResolvedValue({
        yesAsks: levels,
        noAsks: levels.map((level) => ({ ...level, price: 0.65 })),
        yesBids: levels.map((level) => ({ ...level, price: 0.35 })),
        noBids: levels.map((level) => ({ ...level, price: 0.6 })),
        fees: { rate: 0.01 },
        raw: { orderbook: { yes: levels, no: levels } },
      }),
    } as unknown as PredArenaAdapter;
    const appendMarketSnapshot = vi.fn().mockResolvedValue(undefined);
    const store = { appendMarketSnapshot } as unknown as ResearchStore;
    const collector = new PointInTimeCollector(
      predArena,
      store,
      () => new Date("2026-08-07T12:00:00.000Z"),
    );

    const snapshot = await collector.collectMarket({
      marketId: "market-1",
      ticker: "KX-TEST",
      venue: "kalshi",
      title: "Will it rain?",
      closesAt: "2026-08-08T12:00:00.000Z",
      displayedPrice: 0.4,
      volume: 100,
      liquidity: 50,
    });

    expect(snapshot.yesAsks).toHaveLength(10);
    expect(snapshot.noAsks).toHaveLength(10);
    expect(snapshot.yesBids).toHaveLength(10);
    expect(snapshot.noBids).toHaveLength(10);
    expect(snapshot.displayedPrice).toBe(0.4);
    expect(snapshot.noDisplayedPrice).toBe(0.65);
    expect(snapshot.observedAt).toBe("2026-08-07T12:00:00.000Z");
    expect(appendMarketSnapshot).toHaveBeenCalledWith(snapshot);
  });
});
