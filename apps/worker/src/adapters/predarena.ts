import { z } from "zod";

import type {
  BookLevel,
  MarketCandidate,
  PaperOrderRequest,
  PaperOrderResult,
  PaperPortfolio,
  PreviewResult,
  RemoteFill,
  RemoteOrder,
  RemoteOrderLedger,
} from "../contracts";

const JsonObjectSchema = z.record(z.unknown());

const MarketSchema = z
  .object({
    id: z.union([z.string(), z.number()]).optional(),
    market_id: z.union([z.string(), z.number()]).optional(),
    ticker: z.string(),
    venue: z.enum(["kalshi", "polymarket"]),
    title: z.string(),
    display_name: z.string().optional(),
    url: z.string().optional(),
    close_time: z.string().optional(),
    closes_at: z.string().optional(),
    price: z.number().optional(),
    yes_price: z.number().optional(),
    no_price: z.number().optional(),
    volume: z.number().default(0),
    liquidity: z.number().default(0),
    min_order_size: z.number().optional(),
    min_tick_size: z.number().optional(),
  })
  .passthrough();

export interface PredArenaAdapterOptions {
  apiKey: string;
  baseUrl?: string;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export class PredArenaError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "PredArenaError";
  }
}

// All PredArena network traffic must pass through this class.
export class PredArenaAdapter {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private requestTimes: number[] = [];

  constructor(options: PredArenaAdapterOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? "https://predarena.org";
    this.fetcher = options.fetcher ?? fetch;
    this.sleep =
      options.sleep ??
      ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
  }

  async searchMarkets(query: string): Promise<MarketCandidate[]> {
    const response = await this.request(
      "GET",
      `/api/markets/search?q=${encodeURIComponent(query)}`,
    );
    return normalizeMarkets(response);
  }

  async getTrendingMarkets(): Promise<MarketCandidate[]> {
    const response = await this.request("GET", "/api/markets/trending");
    return normalizeMarkets(response);
  }

  async getOrderBook(ticker: string): Promise<{
    yesAsks: BookLevel[];
    noAsks: BookLevel[];
    yesBids: BookLevel[];
    noBids: BookLevel[];
    fees: Record<string, unknown>;
    raw: unknown;
  }> {
    const response = await this.request(
      "GET",
      `/api/markets/orderbook?ticker=${encodeURIComponent(ticker)}`,
    );
    const object = unwrapObject(response);
    const orderBook = readObject(object, "orderbook");
    const yesAsks = normalizeBookLevels(orderBook?.yes);
    const noAsks = normalizeBookLevels(orderBook?.no);
    return {
      yesAsks,
      noAsks,
      yesBids: deriveOppositeBids(noAsks),
      noBids: deriveOppositeBids(yesAsks),
      fees: JsonObjectSchema.catch({}).parse(object.fees),
      raw: response,
    };
  }

  async previewOrder(order: Omit<PaperOrderRequest, "dryRun">): Promise<PreviewResult> {
    const response = await this.request("POST", "/api/v2/portfolio/orders", {
      ...toPredArenaOrder(order),
      dry_run: true,
    });
    const root = unwrapObject(response);
    const object = readObject(root, "preview") ?? {};
    const averagePrice = readNumber(
      object,
      ["avg_price", "projected_vwap", "average_price"],
      Number.NaN,
    );
    const fees = readNumber(object, ["fee_cost", "fees", "projected_fees"], Number.NaN);
    const requiredCash = readNumber(
      object,
      ["required_cash", "total_cost", "total_debit"],
      Number.NaN,
    );
    const rejected = readString(object, ["status"], "").toLowerCase() === "rejected";
    return {
      previewId: readString(object, ["preview_id", "id"], order.clientOrderId),
      status:
        !rejected &&
        Number.isFinite(averagePrice) &&
        Number.isFinite(fees) &&
        Number.isFinite(requiredCash)
          ? "accepted"
          : "rejected",
      averagePrice,
      fees,
      requiredCash,
      raw: response,
    };
  }

  async submitOrder(order: Omit<PaperOrderRequest, "dryRun">): Promise<PaperOrderResult> {
    const response = await this.request(
      "POST",
      "/api/v2/portfolio/orders",
      { ...toPredArenaOrder(order), dry_run: false },
      order.clientOrderId,
    );
    const root = unwrapObject(response);
    const object = readObject(root, "order") ?? {};
    return {
      orderId: readString(object, ["order_id", "id"], ""),
      clientOrderId: readString(object, ["client_order_id"], order.clientOrderId),
      status: readString(object, ["status"], "unknown"),
      averagePrice: readNumber(object, ["avg_price", "average_price", "fill_price"], Number.NaN),
      fees: readNumber(object, ["fee_cost", "fees"], 0),
      raw: response,
    };
  }

  async getPostTradeBooks(ticker: string) {
    await this.sleep(1_000);
    const afterOneSecond = await this.getOrderBook(ticker);
    await this.sleep(4_000);
    const afterFiveSeconds = await this.getOrderBook(ticker);
    return { afterOneSecond, afterFiveSeconds };
  }

  async cancelOrder(orderId: string): Promise<unknown> {
    return this.request("DELETE", `/api/v2/portfolio/orders/${encodeURIComponent(orderId)}`);
  }

  async getPortfolio(): Promise<PaperPortfolio> {
    const response = await this.request("GET", "/api/v2/portfolio");
    const root = unwrapObject(response);
    const portfolio = readObject(root, "portfolio") ?? root;
    const positions = normalizePositions(portfolio.positions);
    const cash = readRequiredNumber(portfolio, ["cash", "cash_balance", "balance"]);
    const nav = readRequiredNumber(portfolio, ["nav", "portfolio_value", "total_value"]);
    return {
      cash,
      nav,
      openExposure: readNumber(
        portfolio,
        ["open_exposure", "open_maximum_loss"],
        positions.reduce((sum, position) => sum + position.maximumLoss, 0),
      ),
      realizedPnl: readNumber(portfolio, ["realized_pnl"], 0),
      unrealizedPnl: readNumber(portfolio, ["unrealized_pnl"], 0),
      positions,
    };
  }

  async getOrdersAndFills(): Promise<RemoteOrderLedger> {
    const response = await this.request("GET", "/api/v2/portfolio/orders");
    const root = unwrapObject(response);
    const orders = [
      ...normalizeRemoteOrders(root.orders),
      ...normalizeRemoteOrders(root.resting_orders),
    ];
    if (!Array.isArray(root.orders) || !Array.isArray(root.fills)) {
      throw new PredArenaError("PredArena order ledger is incomplete", 200, false);
    }
    return {
      orders: deduplicateOrders(orders),
      fills: normalizeRemoteFills(root.fills),
      raw: response,
    };
  }

  async getAnalytics(): Promise<unknown> {
    return this.request("GET", "/api/v2/portfolio/analytics");
  }

  async exportData(type: string): Promise<unknown> {
    return this.request("GET", `/api/v2/portfolio/export?type=${encodeURIComponent(type)}`);
  }

  private async request(
    method: "GET" | "POST" | "DELETE",
    path: string,
    body?: unknown,
    idempotencyKey?: string,
  ): Promise<unknown> {
    if (!this.apiKey) {
      throw new PredArenaError("PredArena API key is missing", null, false);
    }

    const canRetry = method === "GET" || Boolean(idempotencyKey);
    const maximumAttempts = canRetry ? 3 : 1;

    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      await this.waitForRateLimit();
      let response: Response;

      try {
        response = await this.fetcher(`${this.baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
      } catch (error) {
        if (attempt === maximumAttempts) {
          throw new PredArenaError(
            `PredArena network response is unknown: ${String(error)}`,
            null,
            canRetry,
          );
        }
        await this.sleep(250 * 2 ** (attempt - 1));
        continue;
      }

      if (response.ok) {
        return parseJsonResponse(response);
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === maximumAttempts) {
        throw new PredArenaError(
          `PredArena request failed with status ${response.status}`,
          response.status,
          retryable,
        );
      }

      const retryAfterSeconds = Number(response.headers.get("Retry-After"));
      const delay = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : 250 * 2 ** (attempt - 1);
      await this.sleep(delay);
    }

    throw new PredArenaError("PredArena request failed closed", null, false);
  }

  private async waitForRateLimit(): Promise<void> {
    const now = this.now();
    this.requestTimes = this.requestTimes.filter((requestTime) => now - requestTime < 60_000);
    if (this.requestTimes.length >= 8) {
      const oldestRequest = this.requestTimes[0];
      if (oldestRequest !== undefined) {
        await this.sleep(60_000 - (now - oldestRequest) + 10);
      }
      this.requestTimes = this.requestTimes.slice(1);
    }
    this.requestTimes.push(this.now());
  }
}

function toPredArenaOrder(order: Omit<PaperOrderRequest, "dryRun">): Record<string, unknown> {
  return {
    ticker: order.ticker,
    venue: order.venue,
    action: order.action,
    yes_no: order.side,
    count: order.count,
    type: "limit",
    limit_price: order.maximumPrice,
    time_in_force: order.timeInForce,
    client_order_id: order.clientOrderId,
    strategy: order.strategy ?? "slow_value_v1",
  };
}

function normalizeMarkets(value: unknown): MarketCandidate[] {
  const object = unwrapObject(value);
  const candidates = Array.isArray(value)
    ? value
    : Array.isArray(object.markets)
      ? object.markets
      : Array.isArray(object.data)
        ? object.data
        : [];

  return candidates.flatMap((candidate) => {
    const parsed = MarketSchema.safeParse(candidate);
    if (!parsed.success) {
      return [];
    }

    const market = parsed.data;
    const marketId =
      market.venue === "polymarket"
        ? market.ticker
        : String(market.market_id ?? market.id ?? market.ticker);
    return [
      {
        marketId,
        ticker: market.ticker,
        venue: market.venue,
        title: market.title,
        displayName: market.display_name,
        marketUrl: market.url,
        closesAt: market.closes_at ?? market.close_time ?? "",
        displayedPrice: market.yes_price ?? market.price ?? Number.NaN,
        noDisplayedPrice: market.no_price,
        volume: market.volume,
        liquidity: market.liquidity,
        minimumOrderSize: market.min_order_size,
        minimumTickSize: market.min_tick_size,
      },
    ];
  });
}

function normalizeBookLevels(value: unknown): BookLevel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.slice(0, 10).flatMap((level) => {
    if (Array.isArray(level) && typeof level[0] === "number" && typeof level[1] === "number") {
      return [{ price: level[0], quantity: level[1] }];
    }
    const parsed = z.object({ price: z.number(), quantity: z.number() }).safeParse(level);
    return parsed.success ? [parsed.data] : [];
  });
}

function deriveOppositeBids(oppositeAsks: BookLevel[]): BookLevel[] {
  return oppositeAsks
    .map((level) => ({
      price: Number((1 - level.price).toFixed(6)),
      quantity: level.quantity,
    }))
    .filter((level) => level.price > 0 && level.price < 1)
    .sort((left, right) => right.price - left.price)
    .slice(0, 10);
}

function readObject(object: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const parsed = JsonObjectSchema.safeParse(object[key]);
  return parsed.success ? parsed.data : null;
}

function unwrapObject(value: unknown): Record<string, unknown> {
  const parsed = JsonObjectSchema.safeParse(value);
  if (!parsed.success) {
    return {};
  }

  const nested = JsonObjectSchema.safeParse(parsed.data.data);
  return nested.success ? nested.data : parsed.data;
}

function readNumber(object: Record<string, unknown>, keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "object" && value !== null && "total" in value) {
      const total = (value as { total?: unknown }).total;
      if (typeof total === "number") {
        return total;
      }
    }
  }
  return fallback;
}

function readRequiredNumber(object: Record<string, unknown>, keys: string[]): number {
  const value = readNumber(object, keys, Number.NaN);
  if (!Number.isFinite(value)) {
    throw new PredArenaError(`PredArena response is missing ${keys[0]}`, 200, false);
  }
  return value;
}

function readString(object: Record<string, unknown>, keys: string[], fallback: string): string {
  for (const key of keys) {
    if (typeof object[key] === "string") {
      return object[key];
    }
  }
  return fallback;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    throw new PredArenaError("PredArena returned invalid JSON", response.status, false);
  }
}

function normalizePositions(value: unknown): PaperPortfolio["positions"] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((candidate) => {
    const position = JsonObjectSchema.safeParse(candidate);
    if (!position.success) {
      return [];
    }
    const ticker = readString(position.data, ["ticker"], "");
    if (!ticker) {
      return [];
    }
    const quantity = readNumber(position.data, ["count", "quantity", "contracts"], 0);
    const entryPrice = readNumber(
      position.data,
      ["average_price", "avg_price", "entry_price"],
      Number.NaN,
    );
    const maximumLoss = readNumber(
      position.data,
      ["maximum_loss"],
      Number.isFinite(entryPrice) ? quantity * entryPrice : Number.POSITIVE_INFINITY,
    );
    return [
      {
        ticker,
        eventClusterId: readString(position.data, ["event_cluster_id"], ticker),
        maximumLoss,
      },
    ];
  });
}

function normalizeRemoteOrders(value: unknown): RemoteOrder[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    const parsed = JsonObjectSchema.safeParse(candidate);
    if (!parsed.success) {
      return [];
    }
    const orderId = readString(parsed.data, ["order_id", "id"], "");
    if (!orderId) {
      return [];
    }
    return [
      {
        orderId,
        clientOrderId: readString(parsed.data, ["client_order_id"], "") || null,
        strategy: readString(parsed.data, ["strategy"], "") || null,
        status: readString(parsed.data, ["status"], "unknown"),
        raw: parsed.data,
      },
    ];
  });
}

function normalizeRemoteFills(value: unknown): RemoteFill[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((candidate) => {
    const parsed = JsonObjectSchema.safeParse(candidate);
    if (!parsed.success) {
      return [];
    }
    const fillId = readString(parsed.data, ["fill_id", "id"], "");
    const orderId = readString(parsed.data, ["order_id"], "");
    const quantity = readNumber(parsed.data, ["count", "quantity", "contracts"], Number.NaN);
    const price = readNumber(parsed.data, ["price", "fill_price"], Number.NaN);
    if (
      !fillId ||
      !orderId ||
      !Number.isInteger(quantity) ||
      quantity <= 0 ||
      !Number.isFinite(price)
    ) {
      return [];
    }
    return [
      {
        fillId,
        orderId,
        quantity,
        price,
        fee: readNumber(parsed.data, ["fee", "fees", "fee_cost"], 0),
        filledAt: readString(
          parsed.data,
          ["filled_at", "created_at", "executed_at"],
          new Date(0).toISOString(),
        ),
      },
    ];
  });
}

function deduplicateOrders(orders: RemoteOrder[]): RemoteOrder[] {
  return [...new Map(orders.map((order) => [order.orderId, order])).values()];
}
