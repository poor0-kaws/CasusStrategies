import { sha256Hex } from "../crypto";
import type {
  Forecast,
  Relationship,
  ResearchCategory,
  SectorAllocation,
  SectorPerformance,
} from "@casus/core";
import type {
  CollectedMarket,
  MarketCandidate,
  PaperPortfolio,
  ParsedContract,
  RemoteFill,
  StoredSourceDocument,
} from "../contracts";
import type {
  DailyEvaluation,
  GroqUsage,
  ResearchStore,
  StoredPortfolioSnapshot,
} from "./research-store";

export class D1ResearchStore implements ResearchStore {
  constructor(private readonly database: D1Database) {}

  async beginRun(runKey: string, runType: string, now: string): Promise<boolean> {
    const id = await sha256Hex(runKey);
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO system_runs
         (id, run_key, run_type, status, details_json, started_at)
         VALUES (?, ?, ?, 'running', '{}', ?)`,
      )
      .bind(id, runKey, runType, now)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async completeRun(
    runKey: string,
    status: "completed" | "failed",
    details: unknown,
    now: string,
  ): Promise<void> {
    await this.database
      .prepare(
        `UPDATE system_runs
         SET status = ?, details_json = ?, completed_at = ?
         WHERE run_key = ?`,
      )
      .bind(status, JSON.stringify(details), now, runKey)
      .run();
  }

  async saveWatchlist(date: string, markets: MarketCandidate[]): Promise<void> {
    if (markets.length === 0) {
      return;
    }

    const statements = markets.map((market, index) =>
      this.database
        .prepare(
          `INSERT INTO daily_watchlist
           (market_date, market_id, ticker, venue, title, display_name, market_url,
            closes_at, displayed_price, no_displayed_price, volume, liquidity,
            minimum_order_size, minimum_tick_size, rank)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (market_date, market_id) DO UPDATE SET
             ticker = excluded.ticker,
             venue = excluded.venue,
             title = excluded.title,
             display_name = excluded.display_name,
             market_url = excluded.market_url,
             closes_at = excluded.closes_at,
             displayed_price = excluded.displayed_price,
             no_displayed_price = excluded.no_displayed_price,
             volume = excluded.volume,
             liquidity = excluded.liquidity,
             minimum_order_size = excluded.minimum_order_size,
             minimum_tick_size = excluded.minimum_tick_size,
             rank = excluded.rank`,
        )
        .bind(
          date,
          market.marketId,
          market.ticker,
          market.venue,
          market.title,
          market.displayName ?? null,
          market.marketUrl ?? null,
          market.closesAt,
          finiteOrNull(market.displayedPrice),
          finiteOrNull(market.noDisplayedPrice),
          market.volume,
          market.liquidity,
          finiteOrNull(market.minimumOrderSize),
          finiteOrNull(market.minimumTickSize),
          index + 1,
        ),
    );
    await this.database.batch(statements);
  }

  async getWatchlist(date: string): Promise<MarketCandidate[]> {
    const rows = await this.database
      .prepare(
        `SELECT market_id, ticker, venue, title, display_name, market_url, closes_at,
                displayed_price, no_displayed_price, volume, liquidity,
                minimum_order_size, minimum_tick_size
         FROM daily_watchlist
         WHERE market_date = ?
         ORDER BY rank ASC`,
      )
      .bind(date)
      .all<{
        market_id: string;
        ticker: string;
        venue: "kalshi" | "polymarket";
        title: string;
        display_name: string | null;
        market_url: string | null;
        closes_at: string | null;
        displayed_price: number | null;
        no_displayed_price: number | null;
        volume: number | null;
        liquidity: number | null;
        minimum_order_size: number | null;
        minimum_tick_size: number | null;
      }>();

    return rows.results.map((row) => ({
      marketId: row.market_id,
      ticker: row.ticker,
      venue: row.venue,
      title: row.title,
      displayName: row.display_name ?? undefined,
      marketUrl: row.market_url ?? undefined,
      closesAt: row.closes_at ?? "",
      displayedPrice: row.displayed_price ?? Number.NaN,
      noDisplayedPrice: row.no_displayed_price ?? undefined,
      volume: row.volume ?? 0,
      liquidity: row.liquidity ?? 0,
      minimumOrderSize: row.minimum_order_size ?? undefined,
      minimumTickSize: row.minimum_tick_size ?? undefined,
    }));
  }

  async appendMarketSnapshot(snapshot: CollectedMarket): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO market_snapshots
         (id, market_id, ticker, venue, title, displayed_price, bid_depth_json,
          ask_depth_json, yes_bid_depth_json, yes_ask_depth_json,
          no_bid_depth_json, no_ask_depth_json, volume, liquidity, closes_at, fee_json,
          raw_response_hash, observed_at, stored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        await sha256Hex(`${snapshot.marketId}:${snapshot.observedAt}:${snapshot.rawResponseHash}`),
        snapshot.marketId,
        snapshot.ticker,
        snapshot.venue,
        snapshot.title,
        finiteOrZero(snapshot.displayedPrice),
        JSON.stringify(snapshot.yesBids),
        JSON.stringify(snapshot.yesAsks),
        JSON.stringify(snapshot.yesBids),
        JSON.stringify(snapshot.yesAsks),
        JSON.stringify(snapshot.noBids),
        JSON.stringify(snapshot.noAsks),
        snapshot.volume,
        snapshot.liquidity,
        snapshot.closesAt,
        JSON.stringify(snapshot.fees),
        snapshot.rawResponseHash,
        snapshot.observedAt,
        snapshot.storedAt,
      )
      .run();
  }

  async appendContractVersion(contract: ParsedContract): Promise<void> {
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO contract_versions
         (id, market_id, ticker, venue, rules_hash, exact_rules, title, question, yes_condition,
          no_condition, deadline, resolution_source, edge_cases_json,
          ambiguity_score, rule_version, facts_json, observed_at, stored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        contract.id,
        contract.marketId,
        contract.ticker,
        contract.venue,
        contract.contentHash,
        contract.exactRules,
        contract.title,
        contract.question,
        contract.yesCondition,
        contract.noCondition,
        contract.deadline,
        contract.resolutionSource,
        JSON.stringify(contract.edgeCases),
        contract.ambiguityScore,
        contract.ruleVersion,
        JSON.stringify(contract.facts),
        contract.observedAt,
        contract.storedAt,
      )
      .run();
  }

  async getLatestContracts(marketIds: string[]): Promise<ParsedContract[]> {
    if (marketIds.length === 0) {
      return [];
    }

    const placeholders = marketIds.map(() => "?").join(", ");
    const rows = await this.database
      .prepare(
        `SELECT cv.* FROM contract_versions cv
         JOIN (
           SELECT market_id, MAX(observed_at) AS latest_at
           FROM contract_versions
           WHERE market_id IN (${placeholders})
           GROUP BY market_id
         ) latest
         ON cv.market_id = latest.market_id AND cv.observed_at = latest.latest_at`,
      )
      .bind(...marketIds)
      .all<Record<string, unknown>>();

    return rows.results.map((row) => ({
      id: String(row.id),
      marketId: String(row.market_id),
      ticker: String(row.ticker),
      venue: row.venue as "kalshi" | "polymarket",
      title: String(row.title),
      question: String(row.question),
      yesCondition: String(row.yes_condition),
      noCondition: String(row.no_condition),
      deadline: String(row.deadline),
      resolutionSource: String(row.resolution_source),
      edgeCases: JSON.parse(String(row.edge_cases_json)) as string[],
      ambiguityScore: Number(row.ambiguity_score),
      contentHash: String(row.rules_hash),
      ruleVersion: String(row.rule_version),
      observedAt: String(row.observed_at),
      storedAt: String(row.stored_at),
      exactRules: String(row.exact_rules),
      facts: JSON.parse(String(row.facts_json)) as ParsedContract["facts"],
    }));
  }

  async appendSourceDocument(document: StoredSourceDocument): Promise<StoredSourceDocument> {
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO source_documents
         (id, source_type, title, url, excerpt, raw_response_hash,
          source_published_at, observed_at, stored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        document.id,
        document.sourceType,
        document.title,
        document.url,
        document.excerpt,
        document.rawResponseHash,
        document.sourcePublishedAt,
        document.observedAt,
        document.storedAt,
      )
      .run();

    const canonical = await this.database
      .prepare(
        `SELECT id, source_type, title, url, excerpt, raw_response_hash,
                source_published_at, observed_at, stored_at
         FROM source_documents WHERE id = ?`,
      )
      .bind(document.id)
      .first<Record<string, unknown>>();
    if (!canonical) {
      throw new Error("Stored source document could not be read back");
    }
    return sourceFromRow(canonical);
  }

  async appendForecast(forecast: Forecast, evidenceSourceIds: string[]): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO forecasts
         (id, market_id, model_family, category, probability, lower_bound,
          upper_bound, market_prior, evidence_ids_json, likelihood_ratios_json,
          observed_cutoff_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        forecast.id,
        forecast.marketId,
        forecast.modelFamily,
        forecast.category,
        forecast.pointProbability,
        forecast.lowerProbability,
        forecast.upperProbability,
        forecast.marketPrior,
        JSON.stringify(evidenceSourceIds),
        JSON.stringify(forecast.likelihoodRatios),
        forecast.informationCutoffAt,
        forecast.createdAt,
      )
      .run();
  }

  async appendRelationship(relationship: Relationship): Promise<void> {
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO relationships
         (id, from_market_id, to_market_id, relationship_type, ai_explanation,
          verification_status, confidence, rule_version, reviewer_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        relationship.id,
        relationship.leftContractId,
        relationship.rightContractId,
        relationship.kind,
        relationship.explanation,
        relationship.verificationStatus,
        relationship.confidence,
        relationship.ruleVersion,
        relationship.reviewerStatus,
        relationship.createdAt,
      )
      .run();
  }

  async getVerifiedRelationships(contractIds: string[]): Promise<Relationship[]> {
    if (contractIds.length === 0) {
      return [];
    }

    const placeholders = contractIds.map(() => "?").join(", ");
    const rows = await this.database
      .prepare(
        `SELECT id, from_market_id, to_market_id, relationship_type, ai_explanation,
                verification_status, confidence, rule_version, reviewer_status, created_at
         FROM relationships
         WHERE verification_status = 'verified'
           AND from_market_id IN (${placeholders})
           AND to_market_id IN (${placeholders})`,
      )
      .bind(...contractIds, ...contractIds)
      .all<Record<string, unknown>>();

    return rows.results.map((row) => ({
      id: String(row.id),
      leftContractId: String(row.from_market_id),
      rightContractId: String(row.to_market_id),
      kind: row.relationship_type as Relationship["kind"],
      explanation: String(row.ai_explanation),
      verificationStatus: row.verification_status as Relationship["verificationStatus"],
      confidence: Number(row.confidence),
      ruleVersion: String(row.rule_version),
      reviewerStatus: row.reviewer_status as Relationship["reviewerStatus"],
      createdAt: String(row.created_at),
    }));
  }

  async getVerifiedRiskCluster(marketId: string): Promise<{ id: string; tickers: string[] }> {
    const rows = await this.database
      .prepare(
        `SELECT left_contract.market_id AS left_market_id,
                right_contract.market_id AS right_market_id
         FROM relationships relationship
         JOIN contract_versions left_contract
           ON left_contract.id = relationship.from_market_id
         JOIN contract_versions right_contract
           ON right_contract.id = relationship.to_market_id
         WHERE relationship.verification_status = 'verified'`,
      )
      .all<{ left_market_id: string; right_market_id: string }>();

    const connected = new Set([marketId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const row of rows.results) {
        if (connected.has(row.left_market_id) && !connected.has(row.right_market_id)) {
          connected.add(row.right_market_id);
          changed = true;
        }
        if (connected.has(row.right_market_id) && !connected.has(row.left_market_id)) {
          connected.add(row.left_market_id);
          changed = true;
        }
      }
    }

    const marketIds = [...connected].sort();
    const placeholders = marketIds.map(() => "?").join(", ");
    const tickerRows = await this.database
      .prepare(
        `SELECT DISTINCT ticker FROM contract_versions
         WHERE market_id IN (${placeholders})`,
      )
      .bind(...marketIds)
      .all<{ ticker: string }>();
    return {
      id: await sha256Hex(marketIds.join(":")),
      tickers: tickerRows.results.map((row) => row.ticker),
    };
  }

  async appendPortfolioSnapshot(portfolio: PaperPortfolio, observedAt: string): Promise<void> {
    const snapshotId = await sha256Hex(`portfolio:${observedAt}:${JSON.stringify(portfolio)}`);
    const statements = [
      this.database
        .prepare(
          `INSERT INTO portfolio_snapshots
         (id, cash, open_exposure, nav, realized_pnl, unrealized_pnl, observed_at, stored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          snapshotId,
          portfolio.cash,
          portfolio.openExposure,
          portfolio.nav,
          portfolio.realizedPnl,
          portfolio.unrealizedPnl,
          observedAt,
          new Date().toISOString(),
        ),
    ];
    for (const position of portfolio.positions) {
      statements.push(
        this.database
          .prepare(
            `INSERT INTO position_snapshots
             (id, portfolio_snapshot_id, ticker, event_cluster_id, maximum_loss, stored_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            await sha256Hex(`${snapshotId}:${position.ticker}`),
            snapshotId,
            position.ticker,
            position.eventClusterId,
            position.maximumLoss,
            new Date().toISOString(),
          ),
      );
    }
    await this.database.batch(statements);
  }

  async latestPortfolioSnapshot(): Promise<PaperPortfolio | null> {
    const row = await this.database
      .prepare(
        `SELECT id, cash, open_exposure, nav, realized_pnl, unrealized_pnl
         FROM portfolio_snapshots
         ORDER BY observed_at DESC
         LIMIT 1`,
      )
      .first<{
        id: string;
        cash: number;
        open_exposure: number;
        nav: number;
        realized_pnl: number;
        unrealized_pnl: number;
      }>();
    if (!row) {
      return null;
    }

    const positions = await this.positionsForSnapshots([row.id]);

    return {
      cash: row.cash,
      openExposure: row.open_exposure,
      nav: row.nav,
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl,
      positions: positions.get(row.id) ?? [],
    };
  }

  async getSectorExposure(category: ResearchCategory): Promise<number> {
    const row = await this.database
      .prepare(
        `SELECT COALESCE(SUM(position.maximum_loss), 0) AS exposure
         FROM position_snapshots position
         WHERE position.portfolio_snapshot_id = (
           SELECT id FROM portfolio_snapshots ORDER BY observed_at DESC LIMIT 1
         )
         AND EXISTS (
           SELECT 1 FROM trade_intents intent
           WHERE intent.ticker = position.ticker AND intent.category = ?
         )`,
      )
      .bind(category)
      .first<{ exposure: number }>();
    return row?.exposure ?? 0;
  }

  async getSectorPerformance(): Promise<SectorPerformance[]> {
    const rows = await this.database
      .prepare(
        `SELECT intent.id AS intent_id, intent.category, intent.yes_no,
                forecast.market_prior, forecast.probability,
                fill.quantity, fill.price, fill.fee,
                settlement.outcome, settlement.settled_at,
                scenario.one_tick_price, scenario.three_tick_price,
                scenario.one_second_price, scenario.five_second_price
         FROM trade_intents intent
         JOIN orders paper_order ON paper_order.intent_id = intent.id
         JOIN fills fill ON fill.order_id = paper_order.predarena_order_id
         JOIN contract_versions contract ON contract.id = (
           SELECT latest.id FROM contract_versions latest
           WHERE latest.ticker = intent.ticker
           ORDER BY latest.observed_at DESC LIMIT 1
         )
         JOIN settlements settlement ON settlement.market_id = contract.market_id
         LEFT JOIN forecasts forecast ON forecast.id = intent.forecast_id
         LEFT JOIN execution_scenarios scenario ON scenario.intent_id = intent.id
         WHERE intent.category IS NOT NULL
         ORDER BY settlement.settled_at ASC, intent.id ASC`,
      )
      .all<{
        intent_id: string;
        category: ResearchCategory;
        yes_no: "yes" | "no";
        market_prior: number | null;
        probability: number | null;
        quantity: number;
        price: number;
        fee: number;
        outcome: string;
        settled_at: string;
        one_tick_price: number | null;
        three_tick_price: number | null;
        one_second_price: number | null;
        five_second_price: number | null;
      }>();

    const trades = combineFillRows(rows.results);
    return researchCategories.map((category) => sectorPerformance(category, trades));
  }

  async getLatestSectorAllocation(): Promise<SectorAllocation[] | null> {
    const period = await this.database
      .prepare("SELECT MAX(period) AS period FROM sector_allocations")
      .first<{ period: string | null }>();
    if (!period?.period) {
      return null;
    }

    const rows = await this.database
      .prepare(
        `SELECT category, percent FROM sector_allocations
         WHERE period = ? ORDER BY category ASC`,
      )
      .bind(period.period)
      .all<{ category: ResearchCategory; percent: number }>();
    if (rows.results.length !== researchCategories.length) {
      return null;
    }
    return rows.results.map((row) => ({ category: row.category, percent: row.percent }));
  }

  async saveSectorAllocation(
    period: string,
    allocation: SectorAllocation[],
    inputs: SectorPerformance[],
    calculatedAt: string,
  ): Promise<void> {
    await this.database.batch(
      allocation.map((item) =>
        this.database
          .prepare(
            `INSERT OR REPLACE INTO sector_allocations
             (period, category, percent, inputs_json, calculated_at)
             VALUES (?, ?, ?, ?, ?)`,
          )
          .bind(period, item.category, item.percent, JSON.stringify(inputs), calculatedAt),
      ),
    );
  }

  async listPortfolioSnapshots(): Promise<StoredPortfolioSnapshot[]> {
    const rows = await this.database
      .prepare(
        `SELECT id, cash, open_exposure, nav, realized_pnl, unrealized_pnl, observed_at
         FROM portfolio_snapshots
         ORDER BY observed_at ASC`,
      )
      .all<{
        id: string;
        cash: number;
        open_exposure: number;
        nav: number;
        realized_pnl: number;
        unrealized_pnl: number;
        observed_at: string;
      }>();

    const positions = await this.positionsForSnapshots(rows.results.map((row) => row.id));
    return rows.results.map((row) => ({
      cash: row.cash,
      openExposure: row.open_exposure,
      nav: row.nav,
      realizedPnl: row.realized_pnl,
      unrealizedPnl: row.unrealized_pnl,
      positions: positions.get(row.id) ?? [],
      observedAt: row.observed_at,
    }));
  }

  private async positionsForSnapshots(
    snapshotIds: string[],
  ): Promise<Map<string, PaperPortfolio["positions"]>> {
    const positions = new Map<string, PaperPortfolio["positions"]>();
    if (snapshotIds.length === 0) {
      return positions;
    }

    const placeholders = snapshotIds.map(() => "?").join(", ");
    const rows = await this.database
      .prepare(
        `SELECT portfolio_snapshot_id, ticker, event_cluster_id, maximum_loss
         FROM position_snapshots
         WHERE portfolio_snapshot_id IN (${placeholders})`,
      )
      .bind(...snapshotIds)
      .all<{
        portfolio_snapshot_id: string;
        ticker: string;
        event_cluster_id: string;
        maximum_loss: number;
      }>();
    for (const row of rows.results) {
      const group = positions.get(row.portfolio_snapshot_id) ?? [];
      group.push({
        ticker: row.ticker,
        eventClusterId: row.event_cluster_id,
        maximumLoss: row.maximum_loss,
      });
      positions.set(row.portfolio_snapshot_id, group);
    }
    return positions;
  }

  async saveDailyEvaluation(evaluation: DailyEvaluation, createdAt: string): Promise<void> {
    const id = await sha256Hex(`daily-evaluation:${evaluation.metricDate}`);
    await this.database
      .prepare(
        `INSERT INTO daily_metrics (id, metric_date, metrics_json, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT (metric_date) DO UPDATE SET
           metrics_json = excluded.metrics_json,
           created_at = excluded.created_at`,
      )
      .bind(id, evaluation.metricDate, JSON.stringify(evaluation), createdAt)
      .run();
  }

  async hasPublishedReport(period: string): Promise<boolean> {
    const row = await this.database
      .prepare("SELECT period FROM report_publications WHERE period = ? LIMIT 1")
      .bind(period)
      .first<{ period: string }>();
    return Boolean(row);
  }

  async recordPublishedReport(input: {
    period: string;
    reportHash: string;
    githubCommitSha: string;
    publishedAt: string;
  }): Promise<void> {
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO report_publications
         (period, report_hash, github_commit_sha, published_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(input.period, input.reportHash, input.githubCommitSha, input.publishedAt)
      .run();
  }

  async recordWebhook(input: {
    id: string;
    eventType: string;
    payloadHash: string;
    receivedAt: string;
  }): Promise<boolean> {
    const result = await this.database
      .prepare(
        `INSERT OR IGNORE INTO webhook_events
         (id, event_type, payload_hash, received_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(input.id, input.eventType, input.payloadHash, input.receivedAt)
      .run();
    return (result.meta.changes ?? 0) === 1;
  }

  async markWebhookProcessed(id: string, processedAt: string): Promise<void> {
    await this.database
      .prepare("UPDATE webhook_events SET processed_at = ? WHERE id = ?")
      .bind(processedAt, id)
      .run();
  }

  async getGroqUsage(date: string, model: string): Promise<GroqUsage | null> {
    const row = await this.database
      .prepare(
        `SELECT usage_date, model, request_count, input_tokens, output_tokens,
                remaining_requests, remaining_tokens, limit_requests, limit_tokens,
                reset_requests, reset_tokens
         FROM groq_usage WHERE usage_date = ? AND model = ?`,
      )
      .bind(date, model)
      .first<{
        usage_date: string;
        model: string;
        request_count: number;
        input_tokens: number;
        output_tokens: number;
        remaining_requests: number | null;
        remaining_tokens: number | null;
        limit_requests: number | null;
        limit_tokens: number | null;
        reset_requests: string | null;
        reset_tokens: string | null;
      }>();
    if (!row) {
      return null;
    }

    return {
      date: row.usage_date,
      model: row.model,
      requestCount: row.request_count,
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      remainingRequests: row.remaining_requests,
      remainingTokens: row.remaining_tokens,
      limitRequests: row.limit_requests,
      limitTokens: row.limit_tokens,
      resetRequests: row.reset_requests,
      resetTokens: row.reset_tokens,
    };
  }

  async countGroqRequests(date: string): Promise<number> {
    const row = await this.database
      .prepare(
        "SELECT COALESCE(SUM(request_count), 0) AS count FROM groq_usage WHERE usage_date = ?",
      )
      .bind(date)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  async saveGroqUsage(usage: GroqUsage): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO groq_usage
         (usage_date, model, request_count, input_tokens, output_tokens,
          remaining_requests, remaining_tokens, limit_requests, limit_tokens,
          reset_requests, reset_tokens)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (usage_date, model) DO UPDATE SET
           request_count = excluded.request_count,
           input_tokens = excluded.input_tokens,
           output_tokens = excluded.output_tokens,
           remaining_requests = excluded.remaining_requests,
           remaining_tokens = excluded.remaining_tokens,
           limit_requests = excluded.limit_requests,
           limit_tokens = excluded.limit_tokens,
           reset_requests = excluded.reset_requests,
           reset_tokens = excluded.reset_tokens`,
      )
      .bind(
        usage.date,
        usage.model,
        usage.requestCount,
        usage.inputTokens,
        usage.outputTokens,
        usage.remainingRequests,
        usage.remainingTokens,
        usage.limitRequests,
        usage.limitTokens,
        usage.resetRequests,
        usage.resetTokens,
      )
      .run();
  }

  async getModelCache(cacheKey: string) {
    const row = await this.database
      .prepare("SELECT response_json, quota_reliable FROM model_cache WHERE cache_key = ?")
      .bind(cacheKey)
      .first<{ response_json: string; quota_reliable: number }>();
    if (!row) {
      return null;
    }
    return {
      value: JSON.parse(row.response_json) as unknown,
      quotaReliable: row.quota_reliable === 1,
    };
  }

  async saveModelCache(input: {
    cacheKey: string;
    model: string;
    value: unknown;
    quotaReliable: boolean;
    createdAt: string;
  }): Promise<void> {
    await this.database
      .prepare(
        `INSERT OR IGNORE INTO model_cache
         (cache_key, model, response_json, quota_reliable, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .bind(
        input.cacheKey,
        input.model,
        JSON.stringify(input.value),
        input.quotaReliable ? 1 : 0,
        input.createdAt,
      )
      .run();
  }

  async countOrdersForMonth(month: string): Promise<number> {
    const row = await this.database
      .prepare("SELECT COUNT(*) AS count FROM orders WHERE substr(created_at, 1, 7) = ?")
      .bind(month)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  async countOrdersForDate(date: string): Promise<number> {
    const row = await this.database
      .prepare("SELECT COUNT(*) AS count FROM orders WHERE trading_date = ?")
      .bind(date)
      .first<{ count: number }>();
    return row?.count ?? 0;
  }

  async reserveOrderPlacement(date: string, month: string): Promise<boolean> {
    return this.reserveOrderPlacements(date, month, 1);
  }

  async reserveOrderPlacements(date: string, month: string, count: number): Promise<boolean> {
    if (!Number.isInteger(count) || count < 1) {
      return false;
    }
    const daily = await this.readQuota(date, "paper_orders_daily");
    const monthly = await this.readQuota(month, "paper_orders_monthly");
    if (daily + count > 2 || monthly + count > 800) {
      return false;
    }

    const statements = [];
    for (let index = 0; index < count; index += 1) {
      statements.push(quotaIncrement(this.database, date, "paper_orders_daily"));
      statements.push(quotaIncrement(this.database, month, "paper_orders_monthly"));
    }
    await this.database.batch(statements);
    return true;
  }

  async reserveRiskReducingOrder(date: string, month: string): Promise<boolean> {
    const daily = await this.readQuota(date, "risk_reducing_orders_daily");
    const monthly = await this.readQuota(month, "paper_orders_monthly");
    if (daily >= 2 || monthly >= 800) {
      return false;
    }

    await this.database.batch([
      quotaIncrement(this.database, date, "risk_reducing_orders_daily"),
      quotaIncrement(this.database, month, "paper_orders_monthly"),
    ]);
    return true;
  }

  async saveHedgePlan(input: {
    id: string;
    eventClusterId: string;
    relationshipIds: string[];
    preHedgeScenarioLoss: number;
    postHedgeScenarioLoss: number;
    maximumOrphanLoss: number;
    status: string;
    intentIds: string[];
    now: string;
  }): Promise<void> {
    const statements = [
      this.database
        .prepare(
          `INSERT OR REPLACE INTO hedge_plans
           (id, event_cluster_id, strategy, relationship_ids_json,
            pre_hedge_scenario_loss, post_hedge_scenario_loss,
            maximum_orphan_loss, status, created_at, updated_at)
           VALUES (?, ?, 'verified_hedge_v1', ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.id,
          input.eventClusterId,
          JSON.stringify(input.relationshipIds),
          input.preHedgeScenarioLoss,
          input.postHedgeScenarioLoss,
          input.maximumOrphanLoss,
          input.status,
          input.now,
          input.now,
        ),
      ...input.intentIds.map((intentId, index) =>
        this.database
          .prepare(
            `INSERT OR REPLACE INTO hedge_plan_legs
             (hedge_plan_id, intent_id, leg_index, status)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(input.id, intentId, index, "planned"),
      ),
    ];
    await this.database.batch(statements);
  }

  async updateHedgePlanStatus(id: string, status: string, now: string): Promise<void> {
    await this.database
      .prepare("UPDATE hedge_plans SET status = ?, updated_at = ? WHERE id = ?")
      .bind(status, now, id)
      .run();
  }

  async appendEdgeEvaluation(intentId: string, edge: number, createdAt: string): Promise<void> {
    await this.database
      .prepare(
        `INSERT OR REPLACE INTO edge_evaluations
         (intent_id, conservative_edge, passes_4_percent, passes_6_percent,
          passes_8_percent, passes_10_percent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        intentId,
        edge,
        edge >= 0.04 ? 1 : 0,
        edge >= 0.06 ? 1 : 0,
        edge >= 0.08 ? 1 : 0,
        edge >= 0.1 ? 1 : 0,
        createdAt,
      )
      .run();
  }

  async recordExecutionScenario(input: {
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
  }): Promise<void> {
    await this.database
      .prepare(
        `INSERT OR REPLACE INTO execution_scenarios
         (intent_id, contract_count, observed_price, fill_price, fees,
          one_tick_price, three_tick_price, one_second_price, five_second_price,
          assumes_maker_fill, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .bind(
        input.intentId,
        input.count,
        input.observedPrice,
        input.fillPrice,
        input.fees,
        input.oneTickPrice,
        input.threeTickPrice,
        input.oneSecondPrice,
        input.fiveSecondPrice,
        input.createdAt,
      )
      .run();
  }

  async getPrivatePerformanceAdjustments() {
    const rows = await this.database
      .prepare(
        `SELECT contract_count, observed_price, fill_price, fees, one_tick_price,
                three_tick_price, one_second_price, five_second_price
         FROM execution_scenarios`,
      )
      .all<{
        contract_count: number;
        observed_price: number;
        fill_price: number;
        fees: number;
        one_tick_price: number;
        three_tick_price: number;
        one_second_price: number | null;
        five_second_price: number | null;
      }>();

    let signalExecutionCost = 0;
    let conservativeExecutionPenalty = 0;
    for (const row of rows.results) {
      signalExecutionCost +=
        Math.max(0, row.fill_price - row.observed_price) * row.contract_count + row.fees;
      const conservativePrices = [
        row.one_tick_price,
        row.three_tick_price,
        row.one_second_price,
        row.five_second_price,
      ].filter((price): price is number => price !== null && Number.isFinite(price));
      const worstPrice = Math.max(row.fill_price, ...conservativePrices);
      conservativeExecutionPenalty += Math.max(0, worstPrice - row.fill_price) * row.contract_count;
    }
    return { signalExecutionCost, conservativeExecutionPenalty };
  }

  async getTradingFreeze(): Promise<string | null> {
    const row = await this.database
      .prepare("SELECT state_value FROM system_state WHERE state_key = 'trading_freeze'")
      .first<{ state_value: string }>();
    return row?.state_value || null;
  }

  async setTradingFreeze(reason: string | null, now: string): Promise<void> {
    if (!reason) {
      await this.database
        .prepare("DELETE FROM system_state WHERE state_key = 'trading_freeze'")
        .run();
      return;
    }

    await this.database
      .prepare(
        `INSERT INTO system_state (state_key, state_value, updated_at)
         VALUES ('trading_freeze', ?, ?)
         ON CONFLICT (state_key) DO UPDATE SET
           state_value = excluded.state_value,
           updated_at = excluded.updated_at`,
      )
      .bind(reason.slice(0, 500), now)
      .run();
  }

  async listLocalOrders() {
    const rows = await this.database
      .prepare(
        `SELECT client_order_id, predarena_order_id, status
         FROM orders ORDER BY created_at ASC`,
      )
      .all<{
        client_order_id: string;
        predarena_order_id: string | null;
        status: string;
      }>();
    return rows.results.map((row) => ({
      clientOrderId: row.client_order_id,
      predarenaOrderId: row.predarena_order_id,
      status: row.status,
    }));
  }

  async finalizeOrder(input: {
    clientOrderId: string;
    predarenaOrderId: string | null;
    status: string;
    response: unknown;
  }): Promise<void> {
    await this.database
      .prepare(
        `UPDATE orders
         SET predarena_order_id = ?, status = ?, response_json = ?
         WHERE client_order_id = ?`,
      )
      .bind(
        input.predarenaOrderId,
        input.status,
        JSON.stringify(input.response),
        input.clientOrderId,
      )
      .run();
  }

  async appendRemoteFills(fills: RemoteFill[], storedAt: string) {
    if (fills.length === 0) {
      return;
    }
    await this.database.batch(
      fills.map((fill) =>
        this.database
          .prepare(
            `INSERT OR IGNORE INTO fills
             (id, order_id, quantity, price, fee, filled_at, stored_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            fill.fillId,
            fill.orderId,
            fill.quantity,
            fill.price,
            fill.fee,
            fill.filledAt,
            storedAt,
          ),
      ),
    );
  }

  async latestReconciliationStatus() {
    const row = await this.database
      .prepare("SELECT status FROM reconciliation_events ORDER BY observed_at DESC LIMIT 1")
      .first<{ status: "matched" | "mismatch" | "observed" }>();
    return row?.status ?? null;
  }

  private async readQuota(period: string, quotaName: string): Promise<number> {
    const row = await this.database
      .prepare(
        `SELECT used FROM quota_counters
         WHERE period_key = ? AND quota_name = ?`,
      )
      .bind(period, quotaName)
      .first<{ used: number }>();
    return row?.used ?? 0;
  }

  async appendDecisionRecord(input: {
    intent: Record<string, unknown>;
    risk: Record<string, unknown>;
    preview?: Record<string, unknown>;
    order?: Record<string, unknown>;
  }): Promise<void> {
    const statements = [
      this.database
        .prepare(
          `INSERT OR IGNORE INTO trade_intents
           (id, forecast_id, strategy, category, event_cluster_id, hedge_plan_id,
            venue, ticker, action, yes_no, count, maximum_price, minimum_net_edge, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.intent.id,
          input.intent.forecastId,
          input.intent.strategy,
          input.intent.category,
          input.intent.eventClusterId,
          input.intent.hedgePlanId ?? null,
          input.intent.venue,
          input.intent.ticker,
          input.intent.action,
          input.intent.side,
          input.intent.count,
          input.intent.maximumPrice,
          input.intent.minimumNetEdge,
          input.intent.createdAt,
        ),
      this.database
        .prepare(
          `INSERT OR IGNORE INTO risk_decisions
           (id, intent_id, approved, reason_codes_json, maximum_loss,
            open_exposure_after, gross_exposure_after, sector_exposure_after,
            scenario_loss_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.risk.id,
          input.risk.intentId,
          input.risk.approved ? 1 : 0,
          JSON.stringify(input.risk.reasonCodes ?? []),
          input.risk.maximumLoss,
          input.risk.openExposureAfter,
          input.risk.grossExposureAfter,
          input.risk.sectorExposureAfter,
          input.risk.scenarioLossAfter,
          input.risk.createdAt,
        ),
    ];

    if (input.preview) {
      statements.push(
        this.database
          .prepare(
            `INSERT OR IGNORE INTO order_previews
             (id, intent_id, status, average_price, fees, required_cash,
              raw_response_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            input.preview.id,
            input.preview.intentId,
            input.preview.status,
            input.preview.averagePrice,
            input.preview.fees,
            input.preview.requiredCash,
            input.preview.rawResponseHash,
            input.preview.createdAt,
          ),
      );
    }

    if (input.order) {
      statements.push(
        this.database
          .prepare(
            `INSERT INTO orders
             (id, intent_id, client_order_id, predarena_order_id, status,
              request_json, response_json, created_at, trading_date)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT (client_order_id) DO UPDATE SET
               predarena_order_id = excluded.predarena_order_id,
               status = excluded.status,
               response_json = excluded.response_json`,
          )
          .bind(
            input.order.id,
            input.order.intentId,
            input.order.clientOrderId,
            input.order.predarenaOrderId ?? null,
            input.order.status,
            JSON.stringify(input.order.request ?? {}),
            JSON.stringify(input.order.response ?? {}),
            input.order.createdAt,
            input.order.tradingDate ?? null,
          ),
      );
    }

    await this.database.batch(statements);
  }

  async appendReconciliation(input: {
    id: string;
    portfolioHash: string;
    ordersHash: string;
    status: "matched" | "mismatch" | "observed";
    details: unknown;
    observedAt: string;
  }): Promise<void> {
    await this.database
      .prepare(
        `INSERT INTO reconciliation_events
         (id, portfolio_hash, orders_hash, status, details_json, observed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.id,
        input.portfolioHash,
        input.ordersHash,
        input.status,
        JSON.stringify(input.details),
        input.observedAt,
      )
      .run();
  }
}

interface ResolvedSectorTrade {
  intentId: string;
  category: ResearchCategory;
  yesNo: "yes" | "no";
  marketPrior: number | null;
  probability: number | null;
  quantity: number;
  cost: number;
  fees: number;
  conservativePenalty: number;
  outcome: string;
  settledAt: string;
}

const researchCategories: ResearchCategory[] = [
  "weather",
  "economics",
  "public_policy",
  "legal_regulatory",
  "corporate_events",
];

function combineFillRows(
  rows: Array<{
    intent_id: string;
    category: ResearchCategory;
    yes_no: "yes" | "no";
    market_prior: number | null;
    probability: number | null;
    quantity: number;
    price: number;
    fee: number;
    outcome: string;
    settled_at: string;
    one_tick_price: number | null;
    three_tick_price: number | null;
    one_second_price: number | null;
    five_second_price: number | null;
  }>,
): ResolvedSectorTrade[] {
  const trades = new Map<string, ResolvedSectorTrade>();
  for (const row of rows) {
    const worstObservedPrice = Math.max(
      row.price,
      ...[
        row.one_tick_price,
        row.three_tick_price,
        row.one_second_price,
        row.five_second_price,
      ].filter((price): price is number => price !== null && Number.isFinite(price)),
    );
    const existing = trades.get(row.intent_id);
    if (existing) {
      existing.quantity += row.quantity;
      existing.cost += row.quantity * row.price;
      existing.fees += row.fee;
      existing.conservativePenalty += row.quantity * Math.max(0, worstObservedPrice - row.price);
      continue;
    }

    trades.set(row.intent_id, {
      intentId: row.intent_id,
      category: row.category,
      yesNo: row.yes_no,
      marketPrior: row.market_prior,
      probability: row.probability,
      quantity: row.quantity,
      cost: row.quantity * row.price,
      fees: row.fee,
      conservativePenalty: row.quantity * Math.max(0, worstObservedPrice - row.price),
      outcome: row.outcome,
      settledAt: row.settled_at,
    });
  }
  return [...trades.values()];
}

function sectorPerformance(
  category: ResearchCategory,
  allTrades: ResolvedSectorTrade[],
): SectorPerformance {
  const trades = allTrades.filter((trade) => trade.category === category);
  const forecasted = trades.filter(
    (trade) => trade.marketPrior !== null && trade.probability !== null,
  );
  const brier = (probability: "marketPrior" | "probability") => {
    if (forecasted.length === 0) {
      return 0.25;
    }
    return (
      forecasted.reduce((total, trade) => {
        const actual = yesOutcome(trade.outcome) ? 1 : 0;
        return total + ((trade[probability] ?? 0.5) - actual) ** 2;
      }, 0) / forecasted.length
    );
  };

  let runningPnl = 0;
  let peakPnl = 0;
  let maximumDrawdown = 0;
  let conservativePnl = 0;
  let deployedCapital = 0;
  for (const trade of trades) {
    const wins = trade.yesNo === "yes" ? yesOutcome(trade.outcome) : !yesOutcome(trade.outcome);
    const payout = wins ? trade.quantity : 0;
    const pnl = payout - trade.cost - trade.fees - trade.conservativePenalty;
    conservativePnl += pnl;
    deployedCapital += trade.cost + trade.fees;
    runningPnl += pnl;
    peakPnl = Math.max(peakPnl, runningPnl);
    maximumDrawdown = Math.max(maximumDrawdown, peakPnl - runningPnl);
  }

  return {
    category,
    resolvedTrades: trades.length,
    completedMonths: new Set(trades.map((trade) => trade.settledAt.slice(0, 7))).size,
    marketBrier: brier("marketPrior"),
    modelBrier: brier("probability"),
    conservativePnl,
    deployedCapital,
    maxDrawdownPercent: deployedCapital > 0 ? (maximumDrawdown / deployedCapital) * 100 : 0,
  };
}

function yesOutcome(outcome: string): boolean {
  return ["yes", "true", "1"].includes(outcome.trim().toLowerCase());
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function sourceFromRow(row: Record<string, unknown>): StoredSourceDocument {
  return {
    id: String(row.id),
    sourceType: row.source_type as StoredSourceDocument["sourceType"],
    title: String(row.title),
    url: String(row.url),
    excerpt: String(row.excerpt),
    rawResponseHash: String(row.raw_response_hash),
    sourcePublishedAt: String(row.source_published_at),
    observedAt: String(row.observed_at),
    storedAt: String(row.stored_at),
  };
}

function quotaIncrement(
  database: D1Database,
  period: string,
  quotaName: string,
): D1PreparedStatement {
  return database
    .prepare(
      `INSERT INTO quota_counters (period_key, quota_name, used)
       VALUES (?, ?, 1)
       ON CONFLICT (period_key, quota_name) DO UPDATE SET used = used + 1`,
    )
    .bind(period, quotaName);
}

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}
