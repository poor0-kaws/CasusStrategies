import type { MarketVenue } from "../contracts";

export interface RawContractRules {
  marketId: string;
  venue: MarketVenue;
  question: string;
  exactRules: string;
  deadline: string;
  resolutionSource: string;
  raw: unknown;
}

export interface RulesAdapter {
  getRules(identifier: string): Promise<RawContractRules>;
}

interface ReadOnlyAdapterOptions {
  fetcher?: typeof fetch;
}

export class KalshiRulesAdapter implements RulesAdapter {
  private readonly fetcher: typeof fetch;

  constructor(options: ReadOnlyAdapterOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async getRules(ticker: string): Promise<RawContractRules> {
    const response = await this.fetcher(
      `https://api.elections.kalshi.com/trade-api/v2/markets/${encodeURIComponent(ticker)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!response.ok) {
      throw new Error(`Kalshi rules request failed with status ${response.status}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const market = asObject(body.market) ?? body;
    return {
      marketId: readString(market, "ticker", ticker),
      venue: "kalshi",
      question: readString(market, "title", ""),
      exactRules: readString(market, "rules_primary", readString(market, "rules", "")),
      deadline: readString(market, "close_time", ""),
      resolutionSource: readString(market, "settlement_source_url", ""),
      raw: body,
    };
  }
}

export class PolymarketRulesAdapter implements RulesAdapter {
  private readonly fetcher: typeof fetch;

  constructor(options: ReadOnlyAdapterOptions = {}) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async getRules(identifier: string): Promise<RawContractRules> {
    const query = identifier.startsWith("0x")
      ? new URLSearchParams({ condition_ids: identifier })
      : new URLSearchParams({ slug: identifier });
    const response = await this.fetcher(`https://gamma-api.polymarket.com/markets?${query}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Polymarket rules request failed with status ${response.status}`);
    }

    const body = (await response.json()) as unknown;
    const first = Array.isArray(body) ? asObject(body[0]) : asObject(body);
    if (!first) {
      throw new Error("Polymarket did not return contract rules");
    }

    return {
      marketId: readString(first, "conditionId", identifier),
      venue: "polymarket",
      question: readString(first, "question", ""),
      exactRules: readString(first, "description", ""),
      deadline: readString(first, "endDate", ""),
      resolutionSource: readString(first, "resolutionSource", ""),
      raw: body,
    };
  }
}

export class RulesRouter {
  constructor(
    private readonly kalshi: RulesAdapter,
    private readonly polymarket: RulesAdapter,
  ) {}

  getRules(venue: MarketVenue, identifier: string): Promise<RawContractRules> {
    if (venue === "kalshi") {
      return this.kalshi.getRules(identifier);
    }
    return this.polymarket.getRules(identifier);
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(object: Record<string, unknown>, key: string, fallback: string): string {
  return typeof object[key] === "string" ? object[key] : fallback;
}
