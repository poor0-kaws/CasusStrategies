// This file turns verified two-market relationships into previewed, limited paper hedge orders.

import {
  evaluateTwoLegHedge,
  type Relationship,
  type ResearchCategory,
  type ScenarioPosition,
  type ScenarioRelationship,
  type TradeIntent,
} from "@casus/core";

import { PredArenaError, type PredArenaAdapter } from "./adapters/predarena";
import type { CollectedMarket, PaperPortfolio, ParsedContract, PreviewResult } from "./contracts";
import { sha256Hex } from "./crypto";
import type { ResearchStore } from "./store/research-store";

const SIMULATION_PENALTY_PER_LEG = 0.01;
const MINIMUM_PAIR_EDGE = 0.04;

export interface VerifiedHedgeCandidate {
  relationship: Relationship;
  leftContract: ParsedContract;
  rightContract: ParsedContract;
  leftMarket: CollectedMarket;
  rightMarket: CollectedMarket;
  leftSide: "yes" | "no";
  rightSide: "yes" | "no";
  estimatedCost: number;
}

interface HedgeExecutorOptions {
  store: ResearchStore;
  predArena: PredArenaAdapter;
  tradingMode: "shadow" | "paper";
  reconcile: (reason: string) => Promise<PaperPortfolio>;
  now?: () => Date;
}

type SubmissionResult =
  | {
      state: "confirmed";
      order: Awaited<ReturnType<PredArenaAdapter["submitOrder"]>>;
    }
  | { state: "known_failure" }
  | { state: "unknown" };

export function findVerifiedHedgeCandidates(input: {
  relationships: Relationship[];
  contracts: ParsedContract[];
  markets: CollectedMarket[];
  now: Date;
}): VerifiedHedgeCandidate[] {
  const contractById = new Map(input.contracts.map((contract) => [contract.id, contract]));
  const marketById = new Map(input.markets.map((market) => [market.marketId, market]));
  const candidates: VerifiedHedgeCandidate[] = [];

  for (const relationship of input.relationships) {
    if (relationship.verificationStatus !== "verified") {
      continue;
    }

    const leftContract = contractById.get(relationship.leftContractId);
    const rightContract = contractById.get(relationship.rightContractId);
    if (!leftContract || !rightContract) {
      continue;
    }
    if (leftContract.ambiguityScore > 0.2 || rightContract.ambiguityScore > 0.2) {
      continue;
    }

    const leftMarket = marketById.get(leftContract.marketId);
    const rightMarket = marketById.get(rightContract.marketId);
    if (!leftMarket || !rightMarket) {
      continue;
    }
    if (
      closesWithinSixHours(leftMarket, input.now) ||
      closesWithinSixHours(rightMarket, input.now)
    ) {
      continue;
    }

    for (const [leftSide, rightSide] of sidesForRelationship(relationship.kind)) {
      const leftPrice = bestAsk(leftMarket, leftSide);
      const rightPrice = bestAsk(rightMarket, rightSide);
      if (leftPrice === null || rightPrice === null) {
        continue;
      }
      candidates.push({
        relationship,
        leftContract,
        rightContract,
        leftMarket,
        rightMarket,
        leftSide,
        rightSide,
        estimatedCost: leftPrice + rightPrice,
      });
    }
  }

  return candidates.sort((left, right) => left.estimatedCost - right.estimatedCost);
}

export class VerifiedHedgeExecutor {
  private readonly store: ResearchStore;
  private readonly predArena: PredArenaAdapter;
  private readonly tradingMode: "shadow" | "paper";
  private readonly reconcile: (reason: string) => Promise<PaperPortfolio>;
  private readonly now: () => Date;

  constructor(options: HedgeExecutorOptions) {
    this.store = options.store;
    this.predArena = options.predArena;
    this.tradingMode = options.tradingMode;
    this.reconcile = options.reconcile;
    this.now = options.now ?? (() => new Date());
  }

  async execute(
    candidate: VerifiedHedgeCandidate,
    portfolio: PaperPortfolio,
    tradingDate: string,
  ): Promise<number> {
    if (await this.store.getTradingFreeze()) {
      return 0;
    }

    const count = await this.calculateCount(candidate, portfolio);
    if (count < minimumOrderSize(candidate)) {
      return 0;
    }

    const hedgePlanId = await sha256Hex(
      `verified_hedge_v1:${candidate.relationship.id}:${candidate.leftSide}:${candidate.rightSide}:${count}`,
    );
    const intents = await this.createIntents(candidate, count, hedgePlanId);
    const requests = intents.map((intent) => ({
      ticker: intent.ticker,
      venue: intent.venue,
      side: intent.yesNo,
      action: "buy" as const,
      count: intent.count,
      maximumPrice: intent.maximumPrice,
      timeInForce: "FOK" as const,
      clientOrderId: intent.intentId,
      strategy: "verified_hedge_v1" as const,
    }));
    const previews = await Promise.all(
      requests.map((request) => this.predArena.previewOrder(request)),
    );
    if (previews.some((preview) => !isExecutable(preview))) {
      return 0;
    }

    const costs = previews.map((preview) => preview.requiredCash);
    const combinedEdge = 1 - sum(costs) / count - SIMULATION_PENALTY_PER_LEG * 2;
    const relationship: ScenarioRelationship = {
      leftMarketId: candidate.leftMarket.marketId,
      rightMarketId: candidate.rightMarket.marketId,
      kind: candidate.relationship.kind,
      verificationStatus: "verified",
    };
    const legs = toScenarioLegs(candidate, count, previews);
    const evaluation = evaluateTwoLegHedge({
      nav: portfolio.nav,
      existingPositions: [],
      hedgeLegs: legs,
      relationships: [relationship],
      combinedNetEdge: combinedEdge,
      purpose: "new_pair",
    });
    const exposureReasons = await this.exposureReasons(candidate, portfolio, costs, evaluation);
    const approved = evaluation.approved && exposureReasons.length === 0;
    const reasons = [...evaluation.reasons, ...exposureReasons];
    const now = this.now().toISOString();

    await this.store.saveHedgePlan({
      id: hedgePlanId,
      eventClusterId: `relationship:${candidate.relationship.id}`,
      relationshipIds: [candidate.relationship.id],
      preHedgeScenarioLoss: evaluation.preHedgeScenarioLoss,
      postHedgeScenarioLoss: evaluation.postHedgeScenarioLoss,
      maximumOrphanLoss: evaluation.maximumOrphanLoss,
      status: approved ? "previewed" : "rejected",
      intentIds: intents.map((intent) => intent.intentId),
      now,
    });
    await this.recordLegs({
      intents,
      previews,
      costs,
      portfolio,
      approved,
      reasons,
      postHedgeScenarioLoss: evaluation.postHedgeScenarioLoss,
      tradingDate,
      includeOrders: false,
    });

    if (!approved || this.tradingMode !== "paper") {
      return 0;
    }

    const month = now.slice(0, 7);
    if (!(await this.store.reserveOrderPlacements(tradingDate, month, 2))) {
      await this.store.updateHedgePlanStatus(hedgePlanId, "quota_rejected", now);
      return 0;
    }
    await this.recordLegs({
      intents,
      previews,
      costs,
      portfolio,
      approved: true,
      reasons: [],
      postHedgeScenarioLoss: evaluation.postHedgeScenarioLoss,
      tradingDate,
      includeOrders: true,
    });

    const first = await this.submitKnownOrder(requests[0]!, intents[0]!);
    if (first.state !== "confirmed") {
      await this.store.updateHedgePlanStatus(
        hedgePlanId,
        first.state === "unknown" ? "first_leg_unknown" : "first_leg_failed",
        this.now().toISOString(),
      );
      return 0;
    }

    const second = await this.submitKnownOrder(requests[1]!, intents[1]!);
    if (second.state === "confirmed") {
      await this.store.updateHedgePlanStatus(hedgePlanId, "filled", this.now().toISOString());
      return 2;
    }
    if (second.state === "unknown") {
      await this.store.updateHedgePlanStatus(
        hedgePlanId,
        "second_leg_unknown",
        this.now().toISOString(),
      );
      return 0;
    }

    return this.unwindOrphan({
      planId: hedgePlanId,
      firstIntent: intents[0]!,
      firstRequest: requests[0]!,
      firstFillPrice: first.order.averagePrice,
      firstTickSize: candidate.leftMarket.minimumTickSize ?? 0.01,
      portfolio,
      tradingDate,
    });
  }

  private async calculateCount(
    candidate: VerifiedHedgeCandidate,
    portfolio: PaperPortfolio,
  ): Promise<number> {
    const leftPrice = bestAsk(candidate.leftMarket, candidate.leftSide) ?? 1;
    const rightPrice = bestAsk(candidate.rightMarket, candidate.rightSide) ?? 1;
    const visibleDepth = Math.min(
      depth(candidate.leftMarket, candidate.leftSide),
      depth(candidate.rightMarket, candidate.rightSide),
      unwindDepth(candidate.leftMarket, candidate.leftSide),
      unwindDepth(candidate.rightMarket, candidate.rightSide),
    );
    const orphanBound = Math.floor((portfolio.nav * 0.01) / Math.max(leftPrice, rightPrice));
    const clusterBound = Math.floor((portfolio.nav * 0.075) / (leftPrice + rightPrice));
    return Math.max(0, Math.min(visibleDepth, orphanBound, clusterBound));
  }

  private async createIntents(
    candidate: VerifiedHedgeCandidate,
    count: number,
    hedgePlanId: string,
  ): Promise<[TradeIntent, TradeIntent]> {
    const createdAt = this.now().toISOString();
    const clusterId = `relationship:${candidate.relationship.id}`;
    const inputs = [
      {
        contract: candidate.leftContract,
        market: candidate.leftMarket,
        side: candidate.leftSide,
      },
      {
        contract: candidate.rightContract,
        market: candidate.rightMarket,
        side: candidate.rightSide,
      },
    ] as const;
    const intents = await Promise.all(
      inputs.map(async (input, index): Promise<TradeIntent> => ({
        intentId: await sha256Hex(`${hedgePlanId}:leg:${index}`),
        forecastId: `relationship:${candidate.relationship.id}`,
        strategy: "verified_hedge_v1",
        category: categoryForContract(input.contract),
        venue: input.market.venue,
        ticker: input.market.ticker,
        relatedEventClusterId: clusterId,
        hedgePlanId,
        action: "buy",
        yesNo: input.side,
        count,
        maximumPrice: bestAsk(input.market, input.side) ?? 1,
        minimumNetEdge: MINIMUM_PAIR_EDGE,
        createdAt,
      })),
    );
    return [intents[0]!, intents[1]!];
  }

  private async exposureReasons(
    candidate: VerifiedHedgeCandidate,
    portfolio: PaperPortfolio,
    costs: number[],
    evaluation: ReturnType<typeof evaluateTwoLegHedge>,
  ): Promise<string[]> {
    const reasons: string[] = [];
    const totalCost = sum(costs);
    if (costs.some((cost) => cost > portfolio.nav * 0.025)) {
      reasons.push("A hedge leg exceeds the per-market loss limit");
    }
    if (totalCost > portfolio.nav * 0.075) {
      reasons.push("The hedge exceeds the related-cluster loss limit");
    }
    if (Math.max(0, portfolio.nav - portfolio.cash) + totalCost > portfolio.nav * 0.75) {
      reasons.push("The hedge exceeds the gross deployed-capital limit");
    }
    if (portfolio.openExposure + evaluation.postHedgeScenarioLoss > portfolio.nav * 0.25) {
      reasons.push("The hedge exceeds the portfolio scenario-loss limit");
    }

    const sectorCosts = new Map<ResearchCategory, number>();
    const categories = [
      categoryForContract(candidate.leftContract),
      categoryForContract(candidate.rightContract),
    ];
    categories.forEach((category, index) => {
      sectorCosts.set(category, (sectorCosts.get(category) ?? 0) + (costs[index] ?? 0));
    });
    for (const [category, cost] of sectorCosts) {
      const current = await this.store.getSectorExposure(category);
      if (current + cost > portfolio.nav * 0.125) {
        reasons.push(`${category} exposure exceeds the sector loss limit`);
      }
    }
    return reasons;
  }

  private async recordLegs(input: {
    intents: [TradeIntent, TradeIntent];
    previews: [PreviewResult, PreviewResult] | PreviewResult[];
    costs: number[];
    portfolio: PaperPortfolio;
    approved: boolean;
    reasons: string[];
    postHedgeScenarioLoss: number;
    tradingDate: string;
    includeOrders: boolean;
  }): Promise<void> {
    for (let index = 0; index < input.intents.length; index += 1) {
      const intent = input.intents[index]!;
      const preview = input.previews[index]!;
      const cost = input.costs[index] ?? 0;
      const risk = riskRecord({
        intent,
        approved: input.approved,
        reasons: input.reasons,
        maximumLoss: cost,
        portfolio: input.portfolio,
        postHedgeScenarioLoss: input.postHedgeScenarioLoss,
        now: this.now().toISOString(),
      });
      await this.store.appendDecisionRecord({
        intent: intentRecord(intent),
        risk,
        preview: await previewRecord(intent.intentId, preview, this.now().toISOString()),
        ...(input.includeOrders
          ? {
              order: await orderRecord(
                intent,
                input.tradingDate,
                "execution_pending",
                this.now().toISOString(),
              ),
            }
          : {}),
      });
    }
  }

  private async submitKnownOrder(
    request: Parameters<PredArenaAdapter["submitOrder"]>[0],
    intent: TradeIntent,
  ): Promise<SubmissionResult> {
    try {
      const order = await this.predArena.submitOrder(request);
      if (!order.orderId || order.status === "unknown") {
        throw new Error("PredArena hedge order response is unknown");
      }
      await this.store.finalizeOrder({
        clientOrderId: order.clientOrderId,
        predarenaOrderId: order.orderId,
        status: order.status,
        response: order.raw,
      });
      if (["rejected", "cancelled", "expired"].includes(order.status)) {
        return { state: "known_failure" };
      }
      return { state: "confirmed", order };
    } catch (error) {
      if (isKnownRejection(error)) {
        await this.store.finalizeOrder({
          clientOrderId: intent.intentId,
          predarenaOrderId: null,
          status: "rejected",
          response: { error: safeError(error) },
        });
        return { state: "known_failure" };
      }

      await this.store.setTradingFreeze(
        `unknown_hedge_order:${intent.intentId}`,
        this.now().toISOString(),
      );
      try {
        await this.reconcile(`unknown_hedge_order:${intent.intentId}`);
      } catch {
        // The global freeze stays in place until a later reconciliation can prove the outcome.
      }
      return { state: "unknown" };
    }
  }

  private async unwindOrphan(input: {
    planId: string;
    firstIntent: TradeIntent;
    firstRequest: Parameters<PredArenaAdapter["submitOrder"]>[0];
    firstFillPrice: number;
    firstTickSize: number;
    portfolio: PaperPortfolio;
    tradingDate: string;
  }): Promise<number> {
    const freezeReason = `orphan_hedge_leg:${input.planId}`;
    await this.store.setTradingFreeze(freezeReason, this.now().toISOString());
    await this.store.updateHedgePlanStatus(
      input.planId,
      "second_leg_failed",
      this.now().toISOString(),
    );

    try {
      await this.reconcile(freezeReason);
    } catch {
      return 1;
    }
    await this.store.setTradingFreeze(freezeReason, this.now().toISOString());

    const month = this.now().toISOString().slice(0, 7);
    if (!(await this.store.reserveRiskReducingOrder(input.tradingDate, month))) {
      await this.store.setTradingFreeze(
        `unwind_quota_unavailable:${input.planId}`,
        this.now().toISOString(),
      );
      return 1;
    }

    const unwindClientId = await sha256Hex(`${input.planId}:unwind`);
    const unwindRequest = {
      ...input.firstRequest,
      action: "sell" as const,
      maximumPrice: Math.max(0.01, input.firstFillPrice - input.firstTickSize * 2),
      timeInForce: "IOC" as const,
      clientOrderId: unwindClientId,
    };
    const unwindPreview = await this.predArena.previewOrder(unwindRequest);
    if (!isExecutable(unwindPreview)) {
      await this.store.setTradingFreeze(
        `unwind_preview_failed:${input.planId}`,
        this.now().toISOString(),
      );
      return 1;
    }
    const risk = riskRecord({
      intent: input.firstIntent,
      approved: true,
      reasons: ["Pre-approved orphan-leg risk reduction"],
      maximumLoss: 0,
      portfolio: input.portfolio,
      postHedgeScenarioLoss: 0,
      now: this.now().toISOString(),
    });
    await this.store.appendDecisionRecord({
      intent: intentRecord(input.firstIntent),
      risk,
      preview: await previewRecord(
        input.firstIntent.intentId,
        unwindPreview,
        this.now().toISOString(),
      ),
      order: {
        id: await sha256Hex(`order:${unwindClientId}`),
        intentId: input.firstIntent.intentId,
        clientOrderId: unwindClientId,
        predarenaOrderId: null,
        status: "execution_pending",
        request: unwindRequest,
        response: {},
        createdAt: this.now().toISOString(),
        tradingDate: input.tradingDate,
      },
    });

    try {
      const unwind = await this.predArena.submitOrder(unwindRequest);
      const confirmed =
        Boolean(unwind.orderId) &&
        !["unknown", "rejected", "cancelled", "expired"].includes(unwind.status);
      await this.store.finalizeOrder({
        clientOrderId: unwindClientId,
        predarenaOrderId: unwind.orderId || null,
        status: unwind.status,
        response: unwind.raw,
      });
      if (!confirmed) {
        await this.store.setTradingFreeze(
          `unwind_unconfirmed:${input.planId}`,
          this.now().toISOString(),
        );
        return 1;
      }
      await this.reconcile(`unwind_confirmed:${input.planId}`);
      await this.store.updateHedgePlanStatus(input.planId, "unwound", this.now().toISOString());
      await this.store.setTradingFreeze(null, this.now().toISOString());
      return 0;
    } catch (error) {
      await this.store.setTradingFreeze(
        `unwind_failed:${input.planId}:${safeError(error)}`,
        this.now().toISOString(),
      );
      return 1;
    }
  }
}

function sidesForRelationship(kind: Relationship["kind"]): Array<["yes" | "no", "yes" | "no"]> {
  if (kind === "equivalent") {
    return [
      ["yes", "no"],
      ["no", "yes"],
    ];
  }
  if (kind === "exhaustive") {
    return [["yes", "yes"]];
  }
  if (["requires", "threshold_order", "date_subset"].includes(kind)) {
    return [["no", "yes"]];
  }
  return [];
}

function closesWithinSixHours(market: CollectedMarket, now: Date): boolean {
  const closesAt = Date.parse(market.closesAt);
  return !Number.isFinite(closesAt) || closesAt - now.valueOf() < 6 * 60 * 60 * 1_000;
}

function bestAsk(market: CollectedMarket, side: "yes" | "no"): number | null {
  return (side === "yes" ? market.yesAsks[0]?.price : market.noAsks[0]?.price) ?? null;
}

function depth(market: CollectedMarket, side: "yes" | "no"): number {
  const price = bestAsk(market, side);
  if (price === null) {
    return 0;
  }
  return (side === "yes" ? market.yesAsks : market.noAsks)
    .filter((level) => level.price <= price)
    .reduce((total, level) => total + level.quantity, 0);
}

function unwindDepth(market: CollectedMarket, side: "yes" | "no"): number {
  const entryPrice = bestAsk(market, side);
  if (entryPrice === null) {
    return 0;
  }
  const minimumPrice = Math.max(0, entryPrice - (market.minimumTickSize ?? 0.01) * 2);
  return (side === "yes" ? market.yesBids : market.noBids)
    .filter((level) => level.price >= minimumPrice)
    .reduce((total, level) => total + level.quantity, 0);
}

function minimumOrderSize(candidate: VerifiedHedgeCandidate): number {
  return Math.max(
    candidate.leftMarket.minimumOrderSize ?? 1,
    candidate.rightMarket.minimumOrderSize ?? 1,
  );
}

function isExecutable(preview: PreviewResult): boolean {
  return (
    preview.status === "accepted" &&
    Number.isFinite(preview.averagePrice) &&
    Number.isFinite(preview.fees) &&
    Number.isFinite(preview.requiredCash)
  );
}

function toScenarioLegs(
  candidate: VerifiedHedgeCandidate,
  count: number,
  previews: PreviewResult[],
): [ScenarioPosition, ScenarioPosition] {
  return [
    {
      marketId: candidate.leftMarket.marketId,
      side: candidate.leftSide,
      count,
      price: previews[0]!.averagePrice,
      fees: previews[0]!.fees,
    },
    {
      marketId: candidate.rightMarket.marketId,
      side: candidate.rightSide,
      count,
      price: previews[1]!.averagePrice,
      fees: previews[1]!.fees,
    },
  ];
}

function categoryForContract(contract: ParsedContract): ResearchCategory {
  const text = `${contract.title} ${contract.facts.metricKey}`.toLowerCase();
  if (/weather|temperature|rain|snow|hurricane/.test(text)) return "weather";
  if (/inflation|cpi|jobs|unemployment|gdp|rate|treasury/.test(text)) return "economics";
  if (/election|congress|senate|house|bill|vote|candidate|policy/.test(text))
    return "public_policy";
  if (/court|lawsuit|ruling|order|regulation|regulatory|agency/.test(text))
    return "legal_regulatory";
  return "corporate_events";
}

function intentRecord(intent: TradeIntent): Record<string, unknown> {
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

function riskRecord(input: {
  intent: TradeIntent;
  approved: boolean;
  reasons: string[];
  maximumLoss: number;
  portfolio: PaperPortfolio;
  postHedgeScenarioLoss: number;
  now: string;
}): Record<string, unknown> {
  return {
    id: `${input.intent.intentId}:risk`,
    intentId: input.intent.intentId,
    approved: input.approved,
    reasonCodes: input.reasons,
    maximumLoss: input.maximumLoss,
    openExposureAfter: input.portfolio.openExposure + input.postHedgeScenarioLoss,
    grossExposureAfter: Math.max(0, input.portfolio.nav - input.portfolio.cash) + input.maximumLoss,
    sectorExposureAfter: input.maximumLoss,
    scenarioLossAfter: input.portfolio.openExposure + input.postHedgeScenarioLoss,
    createdAt: input.now,
  };
}

async function previewRecord(
  intentId: string,
  preview: PreviewResult,
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

async function orderRecord(
  intent: TradeIntent,
  tradingDate: string,
  status: string,
  now: string,
): Promise<Record<string, unknown>> {
  return {
    id: await sha256Hex(`order:${intent.intentId}`),
    intentId: intent.intentId,
    clientOrderId: intent.intentId,
    predarenaOrderId: null,
    status,
    request: {
      ticker: intent.ticker,
      venue: intent.venue,
      side: intent.yesNo,
      action: intent.action,
      count: intent.count,
      maximumPrice: intent.maximumPrice,
      timeInForce: "FOK",
      clientOrderId: intent.intentId,
      strategy: intent.strategy,
    },
    response: {},
    createdAt: now,
    tradingDate,
  };
}

function isKnownRejection(error: unknown): boolean {
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

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
