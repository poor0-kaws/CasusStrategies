import type {
  ContractVersion,
  FillRecord,
  Forecast,
  MarketSnapshot,
  OrderPreview,
  OrderRecord,
  PortfolioSnapshot,
  Relationship,
  RiskDecision,
  SourceDocument,
  TradeIntent,
  Venue,
} from "@casus/core";

// This alias makes the Worker-to-core boundary explicit without duplicating core models.
export interface SharedContracts {
  contractVersion: ContractVersion;
  fill: FillRecord;
  forecast: Forecast;
  marketSnapshot: MarketSnapshot;
  orderPreview: OrderPreview;
  order: OrderRecord;
  portfolioSnapshot: PortfolioSnapshot;
  relationship: Relationship;
  riskDecision: RiskDecision;
  sourceDocument: SourceDocument;
  tradeIntent: TradeIntent;
  venue: Venue;
}

export type MarketVenue = "kalshi" | "polymarket";

export interface MarketCandidate {
  marketId: string;
  ticker: string;
  venue: MarketVenue;
  title: string;
  displayName?: string | undefined;
  marketUrl?: string | undefined;
  closesAt: string;
  displayedPrice: number;
  noDisplayedPrice?: number | undefined;
  volume: number;
  liquidity: number;
  minimumOrderSize?: number | undefined;
  minimumTickSize?: number | undefined;
}

export interface BookLevel {
  price: number;
  quantity: number;
}

export interface CollectedMarket extends MarketCandidate {
  yesAsks: BookLevel[];
  noAsks: BookLevel[];
  yesBids: BookLevel[];
  noBids: BookLevel[];
  fees: Record<string, unknown>;
  rawResponseHash: string;
  observedAt: string;
  storedAt: string;
}

export interface ParsedContract extends ContractVersion {
  exactRules: string;
  storedAt: string;
}

export interface StoredSourceDocument {
  id: string;
  sourceType: "weather" | "economics";
  title: string;
  url: string;
  excerpt: string;
  rawResponseHash: string;
  sourcePublishedAt: string;
  observedAt: string;
  storedAt: string;
}

export interface PaperPortfolio {
  cash: number;
  nav: number;
  openExposure: number;
  realizedPnl: number;
  unrealizedPnl: number;
  positions: Array<{
    ticker: string;
    eventClusterId: string;
    maximumLoss: number;
  }>;
}

export interface PreviewResult {
  previewId: string;
  status: "accepted" | "rejected";
  averagePrice: number;
  fees: number;
  requiredCash: number;
  raw: unknown;
}

export interface PaperOrderRequest {
  ticker: string;
  venue: MarketVenue;
  side: "yes" | "no";
  action: "buy" | "sell";
  count: number;
  maximumPrice: number;
  timeInForce: "FOK" | "IOC";
  clientOrderId: string;
  dryRun: boolean;
}

export interface PaperOrderResult {
  orderId: string;
  clientOrderId: string;
  status: string;
  averagePrice: number;
  fees: number;
  raw: unknown;
}

export interface RemoteOrder {
  orderId: string;
  clientOrderId: string | null;
  strategy: string | null;
  status: string;
  raw: Record<string, unknown>;
}

export interface RemoteFill {
  fillId: string;
  orderId: string;
  quantity: number;
  price: number;
  fee: number;
  filledAt: string;
}

export interface RemoteOrderLedger {
  orders: RemoteOrder[];
  fills: RemoteFill[];
  raw: unknown;
}
