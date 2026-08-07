import {
  calculateConservativeEdge,
  calculatePreviewEdge,
  calculateQuarterKellySize,
  evaluateRisk,
  type Forecast,
  type ResearchCategory,
  type OrderPreview,
  type TradeIntent,
} from "@casus/core";

import { PredArenaError, type PredArenaAdapter } from "./adapters/predarena";
import type { RulesRouter } from "./adapters/rules";
import type { OfficialSourceRouter } from "./adapters/sources";
import type { PointInTimeCollector } from "./collector";
import type { CollectedMarket, ParsedContract, StoredSourceDocument } from "./contracts";
import { sha256Hex } from "./crypto";
import { buildForecast, type IntelligenceAgents } from "./intelligence";
import { findVerifiedHedgeCandidates, VerifiedHedgeExecutor } from "./hedge-execution";
import type { ScheduledWindow } from "./schedule";
import type { ResearchStore } from "./store/research-store";

const MINIMUM_NET_EDGE = 0.08;
const SIMULATION_PENALTY = 0.01;

interface ResearchPipelineOptions {
  store: ResearchStore;
  predArena: PredArenaAdapter;
  collector: PointInTimeCollector;
  rules: RulesRouter;
  sources: OfficialSourceRouter;
  agents: IntelligenceAgents;
  tradingMode: "shadow" | "paper";
  now?: () => Date;
}

export class ResearchPipeline {
  private readonly store: ResearchStore;
  private readonly predArena: PredArenaAdapter;
  private readonly collector: PointInTimeCollector;
  private readonly rules: RulesRouter;
  private readonly sources: OfficialSourceRouter;
  private readonly agents: IntelligenceAgents;
  private readonly tradingMode: "shadow" | "paper";
  private readonly now: () => Date;

  constructor(options: ResearchPipelineOptions) {
    this.store = options.store;
    this.predArena = options.predArena;
    this.collector = options.collector;
    this.rules = options.rules;
    this.sources = options.sources;
    this.agents = options.agents;
    this.tradingMode = options.tradingMode;
    this.now = options.now ?? (() => new Date());
  }

  async run(
    window: ScheduledWindow,
  ): Promise<{ markets: number; forecasts: number; orders: number }> {
    let portfolio = await this.reconcile("cycle_start");
    if (window.maximumModelRequests === 0) {
      return { markets: 0, forecasts: 0, orders: 0 };
    }
    let watchlist = await this.store.getWatchlist(window.date);
    let quotaReliable = true;

    if (window.isMorningSelection || watchlist.length === 0) {
      const candidates = await this.collector.chooseDailyMarkets();
      if (candidates.length === 0) {
        return { markets: 0, forecasts: 0, orders: 0 };
      }

      const triage = await this.agents.triage(candidates);
      quotaReliable = quotaReliable && triage.quotaReliable;
      const byId = new Map(candidates.map((market) => [market.marketId, market]));
      watchlist = triage.value.flatMap((id) => {
        const market = byId.get(id);
        return market ? [market] : [];
      });
      if (watchlist.length === 0) {
        return { markets: 0, forecasts: 0, orders: 0 };
      }
      await this.store.saveWatchlist(window.date, watchlist);
    }

    const snapshots = await collectSequentially(watchlist, (market) =>
      this.collector.collectMarket(market),
    );
    const rawRules = await collectSequentially(watchlist, async (market) => {
      const identifier = market.venue === "polymarket" ? market.marketId : market.ticker;
      const rules = await this.rules.getRules(market.venue, identifier);
      return { ...rules, marketId: market.marketId };
    });
    let contracts = await this.store.getLatestContracts(watchlist.map((market) => market.marketId));
    if (window.isMorningSelection || contracts.length === 0) {
      const parsed = await this.agents.parseContracts(watchlist, rawRules, this.now());
      quotaReliable = quotaReliable && parsed.quotaReliable;
      contracts = parsed.value.contracts;
      for (const contract of contracts) {
        await this.store.appendContractVersion(contract);
      }
      for (const relationship of parsed.value.relationships) {
        await this.store.appendRelationship(relationship);
      }
    } else {
      contracts = await keepContractsWithUnchangedRules(contracts, rawRules);
    }

    const relationships = await this.store.getVerifiedRelationships(
      contracts.map((contract) => contract.id),
    );
    let orders = 0;
    const hedgeCandidate = findVerifiedHedgeCandidates({
      relationships,
      contracts,
      markets: snapshots,
      now: this.now(),
    })[0];
    if (hedgeCandidate) {
      const hedgeExecutor = new VerifiedHedgeExecutor({
        store: this.store,
        predArena: this.predArena,
        tradingMode: this.tradingMode,
        reconcile: (reason) => this.reconcile(reason),
        now: this.now,
      });
      orders = await hedgeExecutor.execute(hedgeCandidate, portfolio, window.date);
      if (orders > 0) {
        portfolio = await this.reconcile(`after_hedge:${hedgeCandidate.relationship.id}`);
      }
    }

    const sources = await this.collectSources(contracts);
    if (sources.length === 0) {
      await this.reconcile("cycle_end_no_sources");
      return { markets: snapshots.length, forecasts: 0, orders };
    }

    const evidenceResult = await this.agents.analyzeEvidence(contracts, sources);
    const skepticResult = await this.agents.reviewSkeptically(contracts, sources);
    quotaReliable = quotaReliable && evidenceResult.quotaReliable && skepticResult.quotaReliable;

    const snapshotById = new Map(snapshots.map((snapshot) => [snapshot.marketId, snapshot]));
    const contractById = new Map(contracts.map((contract) => [contract.marketId, contract]));
    const skepticById = new Map(skepticResult.value.map((review) => [review.marketId, review]));
    const forecasts: Forecast[] = [];

    for (const evidence of evidenceResult.value) {
      const market = snapshotById.get(evidence.marketId);
      const skeptic = skepticById.get(evidence.marketId);
      if (!market || !skeptic) {
        continue;
      }
      const contract = contractById.get(evidence.marketId);
      const evidenceSources = sourcesForEvidence(
        evidence.evidenceUrls,
        sources,
        contract,
        this.now(),
      );
      if (evidenceSources.length !== evidence.evidenceUrls.length) {
        continue;
      }
      const cutoff = latestObservedAt(evidenceSources);
      if (cutoff > this.now().toISOString()) {
        continue;
      }
      const forecast = await buildForecast({
        market,
        evidence,
        skeptic,
        informationCutoffAt: cutoff,
        now: this.now().toISOString(),
      });
      await this.store.appendForecast(
        forecast,
        evidenceSources.map((source) => source.id),
      );
      forecasts.push(forecast);
    }

    for (const forecast of forecasts) {
      if (orders >= 2) {
        break;
      }
      const market = snapshotById.get(forecast.marketId);
      const contract = contractById.get(forecast.marketId);
      if (!market || !contract) {
        continue;
      }
      const submitted = await this.evaluateAndPreview({
        forecast,
        market,
        contract,
        portfolio,
        date: window.date,
        quotaReliable,
      });
      if (submitted) {
        orders += 1;
        portfolio = await this.reconcile(`after_order:${forecast.id}`);
      }
    }

    await this.reconcile("cycle_end");
    return { markets: snapshots.length, forecasts: forecasts.length, orders };
  }

  async reconcile(reason: string): Promise<Awaited<ReturnType<PredArenaAdapter["getPortfolio"]>>> {
    const observedAt = this.now().toISOString();
    const existingFreeze = await this.store.getTradingFreeze();
    let portfolio: Awaited<ReturnType<PredArenaAdapter["getPortfolio"]>>;
    let ledger: Awaited<ReturnType<PredArenaAdapter["getOrdersAndFills"]>>;
    try {
      [portfolio, ledger] = await Promise.all([
        this.predArena.getPortfolio(),
        this.predArena.getOrdersAndFills(),
      ]);
    } catch (error) {
      await this.store.setTradingFreeze(`reconciliation_failed:${safeError(error)}`, observedAt);
      throw error;
    }

    const localOrders = await this.store.listLocalOrders();
    const remoteByClientId = new Map(
      ledger.orders.flatMap((order) =>
        order.clientOrderId ? [[order.clientOrderId, order] as const] : [],
      ),
    );
    const mismatches: string[] = [];
    for (const local of localOrders) {
      const remote = remoteByClientId.get(local.clientOrderId);
      if (!remote) {
        if (local.status === "rejected") {
          continue;
        }
        mismatches.push(`local_order_missing_remote:${local.clientOrderId}`);
        continue;
      }
      if (local.predarenaOrderId && local.predarenaOrderId !== remote.orderId) {
        mismatches.push(`order_id_mismatch:${local.clientOrderId}`);
        continue;
      }
      await this.store.finalizeOrder({
        clientOrderId: local.clientOrderId,
        predarenaOrderId: remote.orderId,
        status: remote.status,
        response: remote.raw,
      });
    }
    const localClientIds = new Set(localOrders.map((order) => order.clientOrderId));
    for (const remote of ledger.orders) {
      if (
        ["slow_value_v1", "verified_hedge_v1"].includes(remote.strategy ?? "") &&
        (!remote.clientOrderId || !localClientIds.has(remote.clientOrderId))
      ) {
        mismatches.push(`remote_strategy_order_missing_local:${remote.orderId}`);
      }
    }

    const localPredArenaIds = new Set(
      ledger.orders
        .filter((order) => order.clientOrderId && localClientIds.has(order.clientOrderId))
        .map((order) => order.orderId),
    );
    await this.store.appendRemoteFills(
      ledger.fills.filter((fill) => localPredArenaIds.has(fill.orderId)),
      observedAt,
    );
    await this.store.appendPortfolioSnapshot(portfolio, observedAt);
    const portfolioHash = await sha256Hex(JSON.stringify(portfolio));
    const ordersHash = await sha256Hex(JSON.stringify(ledger.raw));
    const status = mismatches.length === 0 ? "matched" : "mismatch";
    await this.store.appendReconciliation({
      id: await sha256Hex(`reconcile:${reason}:${observedAt}`),
      portfolioHash,
      ordersHash,
      status,
      details: { reason, mismatches },
      observedAt,
    });
    await this.store.setTradingFreeze(
      mismatches.length === 0 ? existingFreeze : mismatches.join(","),
      observedAt,
    );
    if (mismatches.length > 0) {
      throw new Error(`PredArena reconciliation mismatch: ${mismatches.join(", ")}`);
    }
    return portfolio;
  }

  private async collectSources(contracts: ParsedContract[]): Promise<StoredSourceDocument[]> {
    const byUrl = new Map<string, { url: string; category: ResearchCategory }>();
    for (const contract of contracts) {
      const category = classifyCategory(contract);
      if (category) {
        byUrl.set(contract.resolutionSource, { url: contract.resolutionSource, category });
      }
    }

    const documents: StoredSourceDocument[] = [];
    for (const source of byUrl.values()) {
      try {
        const document = await this.sources.fetchApproved(source.url, source.category);
        documents.push(await this.store.appendSourceDocument(document));
      } catch {
        // An unavailable or unapproved source removes the market from this cycle.
      }
    }
    return documents;
  }

  private async evaluateAndPreview(input: {
    forecast: Forecast;
    market: CollectedMarket;
    contract: ParsedContract;
    portfolio: Awaited<ReturnType<PredArenaAdapter["getPortfolio"]>>;
    date: string;
    quotaReliable: boolean;
  }): Promise<boolean> {
    if (await this.store.getTradingFreeze()) {
      return false;
    }
    const side = chooseEntrySide(
      input.forecast,
      input.market.yesAsks[0]?.price,
      input.market.noAsks[0]?.price,
    );
    if (!side) {
      return false;
    }

    const entryAsks = side === "yes" ? input.market.yesAsks : input.market.noAsks;
    const exitBids = side === "yes" ? input.market.yesBids : input.market.noBids;
    const entryPrice = entryAsks[0]?.price;
    if (entryPrice === undefined) {
      return false;
    }

    const executableEntryDepth = depthAtOrBelow(entryAsks, entryPrice);
    const visibleExitDepth = totalDepth(exitBids);
    const conservativeProbability =
      side === "yes" ? input.forecast.lowerProbability : 1 - input.forecast.upperProbability;
    const size = calculateQuarterKellySize({
      probability: conservativeProbability,
      allInPrice: entryPrice + SIMULATION_PENALTY,
      nav: input.portfolio.nav,
      maximumLoss: input.portfolio.nav * 0.01,
      visibleDepth: executableEntryDepth,
    });
    const minimumOrderSize = input.market.minimumOrderSize ?? 1;
    if (size.count < minimumOrderSize) {
      return false;
    }

    const riskCluster = await this.store.getVerifiedRiskCluster(input.market.marketId);
    const intent = await createIntent({
      forecast: input.forecast,
      market: input.market,
      side,
      count: size.count,
      entryPrice,
      relatedEventClusterId: riskCluster.id,
      now: this.now().toISOString(),
    });
    const existingPositions = input.portfolio.positions.filter(
      (position) => position.ticker === input.market.ticker,
    );
    const existingPositionCount = existingPositions.length;
    const marketExposure = existingPositions.reduce(
      (sum, position) => sum + position.maximumLoss,
      0,
    );
    const clusterTickers = new Set(riskCluster.tickers);
    const clusterExposure = input.portfolio.positions
      .filter((position) => clusterTickers.has(position.ticker))
      .reduce((sum, position) => sum + position.maximumLoss, 0);
    const risk = evaluateRisk({
      intent,
      nav: input.portfolio.nav,
      marketExposure,
      clusterExposure,
      sectorExposure: await this.store.getSectorExposure(input.forecast.category),
      totalOpenExposure: input.portfolio.openExposure,
      grossDeployed: Math.max(0, input.portfolio.nav - input.portfolio.cash),
      portfolioScenarioLoss: input.portfolio.openExposure,
      ambiguityScore: input.contract.ambiguityScore,
      maximumAllowedAmbiguity: 0.2,
      visibleExitContracts: visibleExitDepth,
      closesAt: input.market.closesAt,
      now: this.now().toISOString(),
      existingPositionCount,
      newPositionsToday: await this.store.countOrdersForDate(input.date),
      apiResponseKnown: true,
    });
    const riskRecord = toRiskRecord(intent, risk, this.now().toISOString());
    if (!risk.approved || !input.quotaReliable) {
      await this.store.appendDecisionRecord({ intent: toIntentRecord(intent), risk: riskRecord });
      return false;
    }

    const orderRequest = {
      ticker: intent.ticker,
      venue: intent.venue,
      side: intent.yesNo,
      action: intent.action,
      count: intent.count,
      maximumPrice: intent.maximumPrice,
      timeInForce: "FOK" as const,
      clientOrderId: intent.intentId,
    };
    const previewResult = await this.predArena.previewOrder(orderRequest);
    const preview: OrderPreview = {
      intentId: intent.intentId,
      executable:
        previewResult.status === "accepted" &&
        Number.isFinite(previewResult.averagePrice) &&
        Number.isFinite(previewResult.fees),
      averagePrice: previewResult.averagePrice,
      fees: previewResult.fees,
      requiredCash: previewResult.requiredCash,
      availableDepth: executableEntryDepth,
      previewedAt: this.now().toISOString(),
    };
    const previewEdge = preview.executable
      ? calculatePreviewEdge({
          forecast: input.forecast,
          intent,
          preview,
          simulationPenalty: SIMULATION_PENALTY,
        })
      : Number.NEGATIVE_INFINITY;
    await this.store.appendEdgeEvaluation(
      intent.intentId,
      Number.isFinite(previewEdge) ? previewEdge : -1,
      this.now().toISOString(),
    );
    const previewRecord = await toPreviewRecord(
      intent.intentId,
      previewResult,
      this.now().toISOString(),
    );

    const maySubmit =
      this.tradingMode === "paper" && preview.executable && previewEdge >= MINIMUM_NET_EDGE;
    if (!maySubmit) {
      await this.store.appendDecisionRecord({
        intent: toIntentRecord(intent),
        risk: riskRecord,
        preview: previewRecord,
      });
      return false;
    }

    const reserved = await this.store.reserveOrderPlacement(
      input.date,
      this.now().toISOString().slice(0, 7),
    );
    if (!reserved) {
      await this.store.appendDecisionRecord({
        intent: toIntentRecord(intent),
        risk: { ...riskRecord, approved: false, reasonCodes: ["order_quota_reached"] },
        preview: previewRecord,
      });
      return false;
    }

    await this.store.appendDecisionRecord({
      intent: toIntentRecord(intent),
      risk: riskRecord,
      preview: previewRecord,
      order: {
        id: await sha256Hex(`order:${intent.intentId}`),
        intentId: intent.intentId,
        clientOrderId: intent.intentId,
        predarenaOrderId: null,
        status: "execution_pending",
        request: orderRequest,
        response: {},
        createdAt: this.now().toISOString(),
        tradingDate: input.date,
      },
    });

    try {
      const order = await this.predArena.submitOrder(orderRequest);
      if (!order.orderId || order.status === "unknown") {
        throw new Error("PredArena order response is unknown");
      }
      await this.store.finalizeOrder({
        clientOrderId: order.clientOrderId,
        predarenaOrderId: order.orderId,
        status: order.status,
        response: order.raw,
      });
      if (Number.isFinite(order.averagePrice)) {
        await this.captureExecutionScenarios({
          intent,
          market: input.market,
          fillPrice: order.averagePrice,
          fees: order.fees,
        });
      }
      return !["rejected", "cancelled", "expired"].includes(order.status);
    } catch (error) {
      if (isKnownValidationRejection(error)) {
        await this.store.finalizeOrder({
          clientOrderId: intent.intentId,
          predarenaOrderId: null,
          status: "rejected",
          response: { error: safeError(error) },
        });
        return false;
      }

      await this.store.setTradingFreeze(
        `unknown_order:${intent.intentId}`,
        this.now().toISOString(),
      );
      await this.reconcile(`unknown_order:${intent.intentId}`);
      return true;
    }
  }

  private async captureExecutionScenarios(input: {
    intent: TradeIntent;
    market: CollectedMarket;
    fillPrice: number;
    fees: number;
  }): Promise<void> {
    let oneSecondPrice: number | null = null;
    let fiveSecondPrice: number | null = null;
    try {
      const books = await this.predArena.getPostTradeBooks(input.market.ticker);
      oneSecondPrice = bestEntryPrice(books.afterOneSecond, input.intent.yesNo);
      fiveSecondPrice = bestEntryPrice(books.afterFiveSeconds, input.intent.yesNo);
    } catch {
      // Missing delayed quotes remain null and make the private warning incomplete.
    }

    const tick = input.market.minimumTickSize ?? 0.01;
    await this.store.recordExecutionScenario({
      intentId: input.intent.intentId,
      count: input.intent.count,
      observedPrice: input.intent.maximumPrice,
      fillPrice: input.fillPrice,
      fees: input.fees,
      oneTickPrice: Math.min(1, input.fillPrice + tick),
      threeTickPrice: Math.min(1, input.fillPrice + tick * 3),
      oneSecondPrice,
      fiveSecondPrice,
      createdAt: this.now().toISOString(),
    });
  }
}

async function collectSequentially<T, R>(items: T[], load: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const item of items) {
    try {
      results.push(await load(item));
    } catch {
      // One unavailable market must not corrupt the rest of the point-in-time batch.
    }
  }
  return results;
}

function classifyCategory(contract: ParsedContract): ResearchCategory | null {
  const text = `${contract.title} ${contract.facts.metricKey}`.toLowerCase();
  if (/weather|temperature|rain|snow|hurricane/.test(text)) {
    return "weather";
  }
  if (/inflation|cpi|jobs|unemployment|gdp|rate|treasury/.test(text)) {
    return "economics";
  }
  if (/election|congress|senate|house|bill|vote|candidate|policy/.test(text)) {
    return "public_policy";
  }
  if (/court|lawsuit|ruling|order|regulation|regulatory|agency/.test(text)) {
    return "legal_regulatory";
  }
  if (/earnings|filing|sec|merger|acquisition|company|corporate/.test(text)) {
    return "corporate_events";
  }
  return null;
}

function latestObservedAt(sources: StoredSourceDocument[]): string {
  return (
    sources
      .map((source) => source.observedAt)
      .sort()
      .at(-1) ?? new Date(0).toISOString()
  );
}

async function keepContractsWithUnchangedRules(
  contracts: ParsedContract[],
  rules: Array<{
    marketId: string;
    exactRules: string;
    deadline: string;
    resolutionSource: string;
  }>,
): Promise<ParsedContract[]> {
  const rulesByMarket = new Map(rules.map((rule) => [rule.marketId, rule]));
  const unchanged: ParsedContract[] = [];
  for (const contract of contracts) {
    const current = rulesByMarket.get(contract.marketId);
    if (!current) {
      continue;
    }
    if (
      (await sha256Hex(current.exactRules)) !== contract.contentHash ||
      current.deadline !== contract.deadline ||
      current.resolutionSource !== contract.resolutionSource
    ) {
      continue;
    }
    unchanged.push(contract);
  }
  return unchanged;
}

export function chooseEntrySide(
  forecast: Forecast,
  yesAsk: number | undefined,
  noAsk: number | undefined,
): "yes" | "no" | null {
  const yesEdge = edgeForAvailablePrice(forecast, "yes", yesAsk);
  const noEdge = edgeForAvailablePrice(forecast, "no", noAsk);
  if (!Number.isFinite(yesEdge) && !Number.isFinite(noEdge)) {
    return null;
  }
  return yesEdge >= noEdge ? "yes" : "no";
}

function edgeForAvailablePrice(
  forecast: Forecast,
  side: "yes" | "no",
  price: number | undefined,
): number {
  if (price === undefined || !Number.isFinite(price)) {
    return Number.NEGATIVE_INFINITY;
  }

  const yesEdge = calculateConservativeEdge({
    side,
    lowerYesProbability: forecast.lowerProbability,
    upperYesProbability: forecast.upperProbability,
    executablePrice: price,
    feePerContract: 0,
    simulationPenalty: SIMULATION_PENALTY,
  });
  return yesEdge;
}

function totalDepth(levels: Array<{ quantity: number }>): number {
  return levels.reduce((sum, level) => sum + level.quantity, 0);
}

function bestEntryPrice(
  book: Awaited<ReturnType<PredArenaAdapter["getOrderBook"]>>,
  side: "yes" | "no",
): number | null {
  return (side === "yes" ? book.yesAsks[0]?.price : book.noAsks[0]?.price) ?? null;
}

function depthAtOrBelow(
  levels: Array<{ price: number; quantity: number }>,
  maximumPrice: number,
): number {
  return levels
    .filter((level) => level.price <= maximumPrice)
    .reduce((sum, level) => sum + level.quantity, 0);
}

async function createIntent(input: {
  forecast: Forecast;
  market: CollectedMarket;
  side: "yes" | "no";
  count: number;
  entryPrice: number;
  relatedEventClusterId: string;
  now: string;
}): Promise<TradeIntent> {
  return {
    intentId: await sha256Hex(
      `slow_value_v1:${input.forecast.id}:${input.side}:${input.count}:${input.entryPrice}`,
    ),
    forecastId: input.forecast.id,
    strategy: "slow_value_v1",
    category: input.forecast.category,
    venue: input.market.venue,
    ticker: input.market.ticker,
    relatedEventClusterId: input.relatedEventClusterId,
    action: "buy",
    yesNo: input.side,
    count: input.count,
    maximumPrice: input.entryPrice,
    minimumNetEdge: MINIMUM_NET_EDGE,
    createdAt: input.now,
  };
}

function toIntentRecord(intent: TradeIntent): Record<string, unknown> {
  return {
    id: intent.intentId,
    forecastId: intent.forecastId,
    strategy: intent.strategy,
    category: intent.category,
    eventClusterId: intent.relatedEventClusterId,
    hedgePlanId: intent.hedgePlanId ?? null,
    venue: intent.venue,
    ticker: intent.ticker,
    action: intent.action,
    side: intent.yesNo,
    count: intent.count,
    maximumPrice: intent.maximumPrice,
    minimumNetEdge: intent.minimumNetEdge,
    createdAt: intent.createdAt,
  };
}

function toRiskRecord(
  intent: TradeIntent,
  risk: ReturnType<typeof evaluateRisk>,
  now: string,
): Record<string, unknown> {
  return {
    id: `${intent.intentId}:risk`,
    intentId: intent.intentId,
    approved: risk.approved,
    reasonCodes: risk.reasons,
    maximumLoss: risk.proposedMaximumLoss,
    openExposureAfter: risk.totalExposureAfter,
    grossExposureAfter: risk.grossExposureAfter,
    sectorExposureAfter: risk.sectorExposureAfter,
    scenarioLossAfter: risk.totalExposureAfter,
    createdAt: now,
  };
}

async function toPreviewRecord(
  intentId: string,
  preview: Awaited<ReturnType<PredArenaAdapter["previewOrder"]>>,
  now: string,
): Promise<Record<string, unknown>> {
  return {
    id: await sha256Hex(`${intentId}:preview:${JSON.stringify(preview.raw)}`),
    intentId,
    status: preview.status,
    averagePrice: preview.averagePrice,
    fees: preview.fees,
    requiredCash: preview.requiredCash,
    rawResponseHash: await sha256Hex(JSON.stringify(preview.raw)),
    createdAt: now,
  };
}

export function sourcesForEvidence(
  evidenceUrls: string[],
  sources: StoredSourceDocument[],
  contract: ParsedContract | undefined,
  now: Date,
): StoredSourceDocument[] {
  if (!contract) {
    return [];
  }

  const category = classifyCategory(contract);
  if (!category) {
    return [];
  }
  const maximumAgeMs = maximumEvidenceAgeMs(category);
  const sourceByUrl = new Map(sources.map((source) => [source.url, source]));
  return evidenceUrls.flatMap((url) => {
    const source = sourceByUrl.get(url);
    if (!source || url !== contract.resolutionSource) {
      return [];
    }
    const publishedAt = new Date(source.sourcePublishedAt).valueOf();
    const observedAt = new Date(source.observedAt).valueOf();
    if (
      !Number.isFinite(publishedAt) ||
      !Number.isFinite(observedAt) ||
      publishedAt > observedAt ||
      observedAt > now.valueOf() ||
      now.valueOf() - publishedAt > maximumAgeMs
    ) {
      return [];
    }
    return [source];
  });
}

function maximumEvidenceAgeMs(category: ResearchCategory): number {
  if (category === "weather") {
    return 48 * 60 * 60 * 1_000;
  }
  if (category === "corporate_events") {
    return 72 * 60 * 60 * 1_000;
  }
  return 7 * 24 * 60 * 60 * 1_000;
}

function isKnownValidationRejection(error: unknown): boolean {
  return (
    error instanceof PredArenaError &&
    error.status !== null &&
    error.status >= 400 &&
    error.status < 500 &&
    error.status !== 429
  );
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : "unknown_error";
}
