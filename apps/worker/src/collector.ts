import { sha256Hex } from "./crypto";
import type { CollectedMarket, MarketCandidate } from "./contracts";
import type { PredArenaAdapter } from "./adapters/predarena";
import type { ResearchStore } from "./store/research-store";

const SLOW_MARKET_TERMS = [
  "weather",
  "temperature",
  "rain",
  "snow",
  "hurricane",
  "inflation",
  "cpi",
  "jobs",
  "unemployment",
  "gdp",
  "federal reserve",
  "interest rate",
  "treasury",
];

export class PointInTimeCollector {
  constructor(
    private readonly predArena: PredArenaAdapter,
    private readonly store: ResearchStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async chooseDailyMarkets(): Promise<MarketCandidate[]> {
    const resultGroups = await Promise.all([
      this.predArena.searchMarkets("weather"),
      this.predArena.searchMarkets("economics"),
      this.predArena.getTrendingMarkets(),
    ]);
    const candidates = deduplicateMarkets(resultGroups.flat());
    const nowMs = this.now().valueOf();

    return candidates
      .filter((market) => isSlowMarket(market.title))
      .filter((market) => {
        const closesAtMs = new Date(market.closesAt).valueOf();
        return Number.isFinite(closesAtMs) && closesAtMs - nowMs >= 6 * 60 * 60 * 1000;
      })
      .filter((market) => Number.isFinite(market.displayedPrice))
      .sort((left, right) => scoreMarket(right) - scoreMarket(left))
      .slice(0, 15);
  }

  async collectMarket(candidate: MarketCandidate): Promise<CollectedMarket> {
    const orderBook = await this.predArena.getOrderBook(candidate.ticker);
    const observedAt = this.now().toISOString();
    const rawResponseHash = await sha256Hex(JSON.stringify(orderBook.raw));
    const bestYesAsk = orderBook.yesAsks[0]?.price;
    const snapshot: CollectedMarket = {
      ...candidate,
      displayedPrice: bestYesAsk ?? candidate.displayedPrice,
      noDisplayedPrice: orderBook.noAsks[0]?.price ?? candidate.noDisplayedPrice,
      yesAsks: orderBook.yesAsks.slice(0, 10),
      noAsks: orderBook.noAsks.slice(0, 10),
      yesBids: orderBook.yesBids.slice(0, 10),
      noBids: orderBook.noBids.slice(0, 10),
      fees: orderBook.fees,
      rawResponseHash,
      observedAt,
      storedAt: this.now().toISOString(),
    };
    await this.store.appendMarketSnapshot(snapshot);
    return snapshot;
  }
}

function deduplicateMarkets(markets: MarketCandidate[]): MarketCandidate[] {
  const byVenueAndMarket = new Map<string, MarketCandidate>();
  for (const market of markets) {
    byVenueAndMarket.set(`${market.venue}:${market.marketId}`, market);
  }
  return [...byVenueAndMarket.values()];
}

function isSlowMarket(title: string): boolean {
  const normalized = title.toLowerCase();
  return SLOW_MARKET_TERMS.some((term) => normalized.includes(term));
}

function scoreMarket(market: MarketCandidate): number {
  return Math.log1p(Math.max(0, market.liquidity)) * 2 + Math.log1p(Math.max(0, market.volume));
}
