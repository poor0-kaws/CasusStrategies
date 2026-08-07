import type { MarketCandidate, ParsedContract } from "../src/contracts";
import type { GroqUsage, LocalOrderRecord, ResearchStore } from "../src/store/research-store";
import { describe, expect, it, vi } from "vitest";

import fixture from "./fixtures/research-cycle.json";
import { GroqClient } from "../src/adapters/groq";
import { PredArenaAdapter } from "../src/adapters/predarena";
import { KalshiRulesAdapter, PolymarketRulesAdapter, RulesRouter } from "../src/adapters/rules";
import {
  EconomicsSourceAdapter,
  OfficialSourceRouter,
  WeatherSourceAdapter,
} from "../src/adapters/sources";
import { PointInTimeCollector } from "../src/collector";
import { IntelligenceAgents } from "../src/intelligence";
import { ResearchPipeline } from "../src/pipeline";
import { getScheduledWindow } from "../src/schedule";

describe("recorded research cycle", () => {
  it("moves one slow market from collection through a confirmed paper fill", async () => {
    const now = () => new Date(fixture.now);
    const memory = createMemoryStore();
    const broker = createPredArenaFixture();
    const groq = createGroqFixture(memory.store);
    const ruleFetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(fixture.rules));
    const sourceFetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(fixture.source, {
        headers: { "Last-Modified": fixture.source.updated },
      }),
    );
    const predArena = new PredArenaAdapter({
      apiKey: "fixture-key",
      baseUrl: "https://fixture.predarena.test",
      fetcher: broker.fetcher,
      sleep: vi.fn().mockResolvedValue(undefined),
      now: () => now().valueOf(),
    });
    const pipeline = new ResearchPipeline({
      store: memory.store,
      predArena,
      collector: new PointInTimeCollector(predArena, memory.store, now),
      rules: new RulesRouter(
        new KalshiRulesAdapter({ fetcher: ruleFetcher }),
        new PolymarketRulesAdapter({ fetcher: ruleFetcher }),
      ),
      sources: new OfficialSourceRouter(
        new WeatherSourceAdapter({ fetcher: sourceFetcher, now }),
        new EconomicsSourceAdapter({ fetcher: sourceFetcher, now }),
      ),
      agents: new IntelligenceAgents(groq),
      tradingMode: "paper",
      now,
    });
    const window = getScheduledWindow(now());
    if (!window) {
      throw new Error("Fixture time must be a scheduled New York research window");
    }

    await expect(pipeline.run(window)).resolves.toEqual({ markets: 1, forecasts: 1, orders: 1 });
    expect(broker.submitted()).toBe(true);
    expect(memory.contracts).toHaveLength(1);
    expect(memory.forecasts).toHaveLength(1);
    expect(memory.decisions.at(-1)?.order?.status).toBe("execution_pending");
    expect(memory.orders[0]).toMatchObject({ predarenaOrderId: "paper-order-1", status: "filled" });
    expect(memory.executionScenarios).toHaveLength(1);
    expect(memory.reconciliations.every((item) => item.status === "matched")).toBe(true);
  });
});

function createPredArenaFixture(): { fetcher: typeof fetch; submitted: () => boolean } {
  let submitted = false;
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname === "/api/v2/portfolio") {
      return Response.json({ cash: 1_000, nav: 1_000, positions: [] });
    }
    if (url.pathname === "/api/v2/portfolio/orders" && method === "GET") {
      return Response.json({
        orders: submitted
          ? [
              {
                id: "paper-order-1",
                client_order_id: currentClientOrderId,
                strategy: "slow_value_v1",
                status: "filled",
              },
            ]
          : [],
        fills: submitted
          ? [
              {
                id: "paper-fill-1",
                order_id: "paper-order-1",
                count: 10,
                price: 0.25,
                fee: 0,
                filled_at: fixture.now,
              },
            ]
          : [],
      });
    }
    if (url.pathname === "/api/markets/search" || url.pathname === "/api/markets/trending") {
      return Response.json({ markets: [fixture.market] });
    }
    if (url.pathname === "/api/markets/orderbook") {
      return Response.json(fixture.book);
    }
    if (url.pathname === "/api/v2/portfolio/orders" && method === "POST") {
      const body = JSON.parse(String(init?.body)) as {
        client_order_id: string;
        count: number;
        dry_run: boolean;
      };
      currentClientOrderId = body.client_order_id;
      if (body.dry_run) {
        return Response.json({
          preview: {
            preview_id: "preview-1",
            status: "preview",
            avg_price: 0.25,
            fee_cost: 0,
            total_cost: body.count * 0.25,
          },
        });
      }
      submitted = true;
      return Response.json({
        order: {
          id: "paper-order-1",
          client_order_id: body.client_order_id,
          status: "filled",
          avg_price: 0.25,
          fee_cost: 0,
        },
      });
    }
    return new Response("Missing fixture", { status: 404 });
  });
  let currentClientOrderId = "";
  return { fetcher, submitted: () => submitted };
}

function createGroqFixture(store: ResearchStore): GroqClient {
  const responses: Record<string, unknown> = {
    "llama-3.1-8b-instant": fixture.agents.triage,
    "openai/gpt-oss-120b": fixture.agents.contract,
    "openai/gpt-oss-20b": fixture.agents.evidence,
    "llama-3.3-70b-versatile": fixture.agents.skeptic,
  };
  const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string };
    return Response.json(
      {
        choices: [{ message: { content: JSON.stringify(responses[body.model]) } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      },
      {
        headers: {
          "x-ratelimit-remaining-requests": "99",
          "x-ratelimit-remaining-tokens": "99900",
          "x-ratelimit-limit-requests": "100",
          "x-ratelimit-limit-tokens": "100000",
          "x-ratelimit-reset-requests": "1d",
          "x-ratelimit-reset-tokens": "1m",
        },
      },
    );
  });
  return new GroqClient({
    apiKey: "fixture-key",
    store,
    fetcher,
    now: () => new Date(fixture.now),
  });
}

function createMemoryStore() {
  const watchlist: MarketCandidate[] = [];
  const contracts: ParsedContract[] = [];
  const forecasts: unknown[] = [];
  const decisions: Array<{ order?: Record<string, unknown> }> = [];
  const orders: LocalOrderRecord[] = [];
  const executionScenarios: unknown[] = [];
  const reconciliations: Array<{ status: string }> = [];
  const groqUsage = new Map<string, GroqUsage>();
  const modelCache = new Map<string, { value: unknown; quotaReliable: boolean }>();
  let tradingFreeze: string | null = null;

  const store = {
    getWatchlist: vi.fn(async () => watchlist),
    saveWatchlist: vi.fn(async (_date: string, markets: MarketCandidate[]) => {
      watchlist.push(...markets);
    }),
    appendMarketSnapshot: vi.fn(),
    getLatestContracts: vi.fn(async () => contracts),
    appendContractVersion: vi.fn(async (contract: ParsedContract) => {
      contracts.push(contract);
    }),
    appendRelationship: vi.fn(),
    appendSourceDocument: vi.fn(async (document) => document),
    appendForecast: vi.fn(async (forecast) => {
      forecasts.push(forecast);
    }),
    getVerifiedRiskCluster: vi.fn(async () => ({ id: "cluster:WX-TEST", tickers: ["WX-TEST"] })),
    appendPortfolioSnapshot: vi.fn(),
    getTradingFreeze: vi.fn(async () => tradingFreeze),
    setTradingFreeze: vi.fn(async (reason: string | null) => {
      tradingFreeze = reason;
    }),
    listLocalOrders: vi.fn(async () => orders),
    appendRemoteFills: vi.fn(),
    appendReconciliation: vi.fn(async (record: { status: string }) => {
      reconciliations.push(record);
    }),
    countOrdersForDate: vi.fn(async () => orders.length),
    reserveOrderPlacement: vi.fn(async () => true),
    appendEdgeEvaluation: vi.fn(),
    recordExecutionScenario: vi.fn(async (scenario) => {
      executionScenarios.push(scenario);
    }),
    appendDecisionRecord: vi.fn(async (record: { order?: Record<string, unknown> }) => {
      decisions.push(record);
      if (record.order) {
        orders.push({
          clientOrderId: String(record.order.clientOrderId),
          predarenaOrderId: null,
          status: String(record.order.status),
        });
      }
    }),
    finalizeOrder: vi.fn(async (input: LocalOrderRecord) => {
      const order = orders.find((item) => item.clientOrderId === input.clientOrderId);
      if (!order) {
        throw new Error("Fixture order was not reserved before submission");
      }
      order.predarenaOrderId = input.predarenaOrderId;
      order.status = input.status;
    }),
    countGroqRequests: vi.fn(async () =>
      [...groqUsage.values()].reduce((sum, item) => sum + item.requestCount, 0),
    ),
    getGroqUsage: vi.fn(async (_date: string, model: string) => groqUsage.get(model) ?? null),
    saveGroqUsage: vi.fn(async (usage: GroqUsage) => {
      groqUsage.set(usage.model, usage);
    }),
    getModelCache: vi.fn(async (key: string) => modelCache.get(key) ?? null),
    saveModelCache: vi.fn(
      async (input: { cacheKey: string; value: unknown; quotaReliable: boolean }) => {
        modelCache.set(input.cacheKey, {
          value: input.value,
          quotaReliable: input.quotaReliable,
        });
      },
    ),
  } as unknown as ResearchStore;

  return { store, contracts, forecasts, decisions, orders, executionScenarios, reconciliations };
}
