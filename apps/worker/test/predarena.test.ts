import { describe, expect, it, vi } from "vitest";

import { PredArenaAdapter } from "../src/adapters/predarena";

describe("PredArenaAdapter", () => {
  it("uses dry-run order previews without changing the idempotency ID", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        preview: {
          preview_id: "preview-1",
          status: "preview",
          avg_price: 0.51,
          fee_cost: 0.01,
          total_cost: 5.11,
          fill_legs: [{ price: 0.51, count: 10 }],
        },
      }),
    );
    const adapter = new PredArenaAdapter({ apiKey: "secret", fetcher });

    const preview = await adapter.previewOrder({
      ticker: "KX-TEST",
      venue: "kalshi",
      side: "yes",
      action: "buy",
      count: 10,
      maximumPrice: 0.52,
      timeInForce: "FOK",
      clientOrderId: "intent-1",
    });

    expect(preview.averagePrice).toBe(0.51);
    expect(preview.fees).toBe(0.01);
    expect(preview.requiredCash).toBe(5.11);
    const request = fetcher.mock.calls[0]?.[1];
    expect(JSON.parse(String(request?.body))).toMatchObject({
      dry_run: true,
      client_order_id: "intent-1",
      time_in_force: "FOK",
    });
  });

  it("reads YES and NO asks and derives each side's exit bids", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        ticker: "KX-TEST",
        venue: "kalshi",
        orderbook: {
          yes: [
            { price: 0.42, quantity: 8 },
            { price: 0.44, quantity: 20 },
          ],
          no: [
            { price: 0.61, quantity: 6 },
            { price: 0.63, quantity: 10 },
          ],
        },
      }),
    );
    const adapter = new PredArenaAdapter({ apiKey: "secret", fetcher });

    const book = await adapter.getOrderBook("KX-TEST");

    expect(book.yesAsks).toEqual([
      { price: 0.42, quantity: 8 },
      { price: 0.44, quantity: 20 },
    ]);
    expect(book.noAsks[0]).toEqual({ price: 0.61, quantity: 6 });
    expect(book.yesBids[0]).toEqual({ price: 0.39, quantity: 6 });
    expect(book.noBids[0]).toEqual({ price: 0.58, quantity: 8 });
  });

  it("reads submitted orders from the nested order object", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        order: {
          id: "order-1",
          client_order_id: "intent-1",
          status: "filled",
          avg_price: 0.51,
        },
      }),
    );
    const adapter = new PredArenaAdapter({ apiKey: "secret", fetcher });

    const order = await adapter.submitOrder({
      ticker: "KX-TEST",
      venue: "kalshi",
      side: "yes",
      action: "buy",
      count: 10,
      maximumPrice: 0.52,
      timeInForce: "FOK",
      clientOrderId: "intent-1",
    });

    expect(order).toMatchObject({
      orderId: "order-1",
      clientOrderId: "intent-1",
      status: "filled",
    });
  });

  it("retries an unknown network result with the same idempotency ID", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce(
        Response.json({
          order: {
            id: "order-1",
            client_order_id: "stable-intent",
            status: "executed",
            avg_price: 0.5,
          },
        }),
      );
    const adapter = new PredArenaAdapter({
      apiKey: "secret",
      fetcher,
      sleep: vi.fn().mockResolvedValue(undefined),
    });

    await adapter.submitOrder({
      ticker: "KX-TEST",
      venue: "kalshi",
      side: "yes",
      action: "buy",
      count: 2,
      maximumPrice: 0.51,
      timeInForce: "FOK",
      clientOrderId: "stable-intent",
    });

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.map((call) => call[1]?.body)).toEqual([
      fetcher.mock.calls[0]?.[1]?.body,
      fetcher.mock.calls[0]?.[1]?.body,
    ]);
    expect(fetcher.mock.calls[1]?.[1]?.headers).toMatchObject({
      "Idempotency-Key": "stable-intent",
    });
  });

  it("rejects an incomplete dry run instead of guessing required cash", async () => {
    const adapter = new PredArenaAdapter({
      apiKey: "secret",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          preview: { status: "preview", avg_price: 0.5, fee_cost: 0.01 },
        }),
      ),
    });

    await expect(
      adapter.previewOrder({
        ticker: "KX-TEST",
        venue: "kalshi",
        side: "yes",
        action: "buy",
        count: 2,
        maximumPrice: 0.51,
        timeInForce: "FOK",
        clientOrderId: "intent-incomplete",
      }),
    ).resolves.toMatchObject({ status: "rejected" });
  });

  it("normalizes the remote order and fill ledger for reconciliation", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        orders: [
          {
            id: "order-1",
            client_order_id: "intent-1",
            strategy: "slow_value_v1",
            status: "executed",
          },
        ],
        resting_orders: [],
        fills: [
          {
            id: "fill-1",
            order_id: "order-1",
            count: 4,
            price: 0.51,
            fee: 0.01,
            filled_at: "2026-08-07T12:00:00.000Z",
          },
        ],
      }),
    );
    const adapter = new PredArenaAdapter({ apiKey: "secret", fetcher });

    await expect(adapter.getOrdersAndFills()).resolves.toMatchObject({
      orders: [{ orderId: "order-1", clientOrderId: "intent-1", status: "executed" }],
      fills: [{ fillId: "fill-1", orderId: "order-1", quantity: 4, price: 0.51 }],
    });
  });

  it("fails closed when reconciliation arrays are missing", async () => {
    const adapter = new PredArenaAdapter({
      apiKey: "secret",
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ orders: [] })),
    });

    await expect(adapter.getOrdersAndFills()).rejects.toThrow("ledger is incomplete");
  });

  it("honors Retry-After on a rate-limit response", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("limited", { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(Response.json({ cash: 1_000, nav: 1_000 }));
    const adapter = new PredArenaAdapter({ apiKey: "secret", fetcher, sleep });

    await expect(adapter.getPortfolio()).resolves.toMatchObject({ nav: 1_000 });
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
