import type {
  CollectedMarket,
  MarketCandidate,
  PaperPortfolio,
  ParsedContract,
  StoredSourceDocument,
} from "../contracts";
import type {
  Forecast,
  Relationship,
  ResearchCategory,
  SectorAllocation,
  SectorPerformance,
} from "@casus/core";
import type { RemoteFill } from "../contracts";

export interface GroqUsage {
  date: string;
  model: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  remainingRequests: number | null;
  remainingTokens: number | null;
  limitRequests: number | null;
  limitTokens: number | null;
  resetRequests: string | null;
  resetTokens: string | null;
}

export interface StoredPortfolioSnapshot extends PaperPortfolio {
  observedAt: string;
}

export interface DailyEvaluation {
  metricDate: string;
  mode: "shadow" | "paper";
  officialNav: number;
  officialPnl: number;
  cash: number;
  openExposure: number;
  realizedPnl: number;
  unrealizedPnl: number;
  overallReturnPercent: number;
  positionCount: number;
  orderCount: number;
  signalPnl: number | null;
  conservativePnl: number | null;
  observedAt: string;
}

export interface LocalOrderRecord {
  clientOrderId: string;
  predarenaOrderId: string | null;
  status: string;
}

export interface ModelCacheEntry {
  value: unknown;
  quotaReliable: boolean;
}

export interface PrivatePerformanceAdjustments {
  signalExecutionCost: number;
  conservativeExecutionPenalty: number;
}

export interface ResearchStore {
  beginRun(runKey: string, runType: string, now: string): Promise<boolean>;
  completeRun(
    runKey: string,
    status: "completed" | "failed",
    details: unknown,
    now: string,
  ): Promise<void>;
  saveWatchlist(date: string, markets: MarketCandidate[]): Promise<void>;
  getWatchlist(date: string): Promise<MarketCandidate[]>;
  appendMarketSnapshot(snapshot: CollectedMarket): Promise<void>;
  appendContractVersion(contract: ParsedContract): Promise<void>;
  getLatestContracts(marketIds: string[]): Promise<ParsedContract[]>;
  appendSourceDocument(document: StoredSourceDocument): Promise<StoredSourceDocument>;
  appendForecast(forecast: Forecast, evidenceSourceIds: string[]): Promise<void>;
  appendRelationship(relationship: Relationship): Promise<void>;
  getVerifiedRelationships(contractIds: string[]): Promise<Relationship[]>;
  getVerifiedRiskCluster(marketId: string): Promise<{ id: string; tickers: string[] }>;
  appendPortfolioSnapshot(portfolio: PaperPortfolio, observedAt: string): Promise<void>;
  latestPortfolioSnapshot(): Promise<PaperPortfolio | null>;
  getSectorExposure(category: ResearchCategory): Promise<number>;
  getSectorPerformance(): Promise<SectorPerformance[]>;
  getLatestSectorAllocation(): Promise<SectorAllocation[] | null>;
  saveSectorAllocation(
    period: string,
    allocation: SectorAllocation[],
    inputs: SectorPerformance[],
    calculatedAt: string,
  ): Promise<void>;
  listPortfolioSnapshots(): Promise<StoredPortfolioSnapshot[]>;
  saveDailyEvaluation(evaluation: DailyEvaluation, createdAt: string): Promise<void>;
  hasPublishedReport(period: string): Promise<boolean>;
  recordPublishedReport(input: {
    period: string;
    reportHash: string;
    githubCommitSha: string;
    publishedAt: string;
  }): Promise<void>;
  recordWebhook(input: {
    id: string;
    eventType: string;
    payloadHash: string;
    receivedAt: string;
  }): Promise<boolean>;
  markWebhookProcessed(id: string, processedAt: string): Promise<void>;
  getGroqUsage(date: string, model: string): Promise<GroqUsage | null>;
  countGroqRequests(date: string): Promise<number>;
  saveGroqUsage(usage: GroqUsage): Promise<void>;
  getModelCache(cacheKey: string): Promise<ModelCacheEntry | null>;
  saveModelCache(input: {
    cacheKey: string;
    model: string;
    value: unknown;
    quotaReliable: boolean;
    createdAt: string;
  }): Promise<void>;
  countOrdersForMonth(month: string): Promise<number>;
  countOrdersForDate(date: string): Promise<number>;
  reserveOrderPlacement(date: string, month: string): Promise<boolean>;
  reserveOrderPlacements(date: string, month: string, count: number): Promise<boolean>;
  reserveRiskReducingOrder(date: string, month: string): Promise<boolean>;
  saveHedgePlan(input: {
    id: string;
    eventClusterId: string;
    relationshipIds: string[];
    preHedgeScenarioLoss: number;
    postHedgeScenarioLoss: number;
    maximumOrphanLoss: number;
    status: string;
    intentIds: string[];
    now: string;
  }): Promise<void>;
  updateHedgePlanStatus(id: string, status: string, now: string): Promise<void>;
  appendEdgeEvaluation(intentId: string, edge: number, createdAt: string): Promise<void>;
  recordExecutionScenario(input: {
    intentId: string;
    count: number;
    observedPrice: number;
    fillPrice: number;
    fees: number;
    oneTickPrice: number;
    threeTickPrice: number;
    oneSecondPrice: number | null;
    fiveSecondPrice: number | null;
    createdAt: string;
  }): Promise<void>;
  getPrivatePerformanceAdjustments(): Promise<PrivatePerformanceAdjustments>;
  getTradingFreeze(): Promise<string | null>;
  setTradingFreeze(reason: string | null, now: string): Promise<void>;
  listLocalOrders(): Promise<LocalOrderRecord[]>;
  finalizeOrder(input: {
    clientOrderId: string;
    predarenaOrderId: string | null;
    status: string;
    response: unknown;
  }): Promise<void>;
  appendRemoteFills(fills: RemoteFill[], storedAt: string): Promise<void>;
  latestReconciliationStatus(): Promise<"matched" | "mismatch" | "observed" | null>;
  appendDecisionRecord(input: {
    intent: Record<string, unknown>;
    risk: Record<string, unknown>;
    preview?: Record<string, unknown>;
    order?: Record<string, unknown>;
  }): Promise<void>;
  appendReconciliation(input: {
    id: string;
    portfolioHash: string;
    ordersHash: string;
    status: "matched" | "mismatch" | "observed";
    details: unknown;
    observedAt: string;
  }): Promise<void>;
}
