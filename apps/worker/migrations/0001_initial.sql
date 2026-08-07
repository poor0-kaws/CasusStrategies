PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contract_versions (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  venue TEXT NOT NULL,
  rules_hash TEXT NOT NULL,
  exact_rules TEXT NOT NULL,
  title TEXT NOT NULL,
  question TEXT NOT NULL,
  yes_condition TEXT NOT NULL,
  no_condition TEXT NOT NULL,
  deadline TEXT NOT NULL,
  resolution_source TEXT NOT NULL,
  edge_cases_json TEXT NOT NULL,
  ambiguity_score REAL NOT NULL CHECK (ambiguity_score >= 0 AND ambiguity_score <= 1),
  rule_version TEXT NOT NULL,
  facts_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  UNIQUE (market_id, rules_hash)
);

CREATE TABLE IF NOT EXISTS market_snapshots (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  venue TEXT NOT NULL,
  title TEXT NOT NULL,
  displayed_price REAL NOT NULL,
  bid_depth_json TEXT NOT NULL,
  ask_depth_json TEXT NOT NULL,
  volume REAL NOT NULL,
  liquidity REAL NOT NULL,
  closes_at TEXT NOT NULL,
  fee_json TEXT NOT NULL,
  raw_response_hash TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  stored_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_snapshots_market_time ON market_snapshots(market_id, observed_at);

CREATE TABLE IF NOT EXISTS source_documents (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  raw_response_hash TEXT NOT NULL,
  source_published_at TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  stored_at TEXT NOT NULL,
  UNIQUE (url, raw_response_hash)
);

CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  from_market_id TEXT NOT NULL,
  to_market_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL,
  ai_explanation TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  confidence REAL NOT NULL,
  rule_version TEXT NOT NULL,
  reviewer_status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS forecasts (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  model_family TEXT NOT NULL,
  category TEXT NOT NULL,
  probability REAL NOT NULL,
  lower_bound REAL NOT NULL,
  upper_bound REAL NOT NULL,
  market_prior REAL NOT NULL,
  evidence_ids_json TEXT NOT NULL,
  observed_cutoff_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trade_intents (
  id TEXT PRIMARY KEY,
  forecast_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  venue TEXT NOT NULL,
  ticker TEXT NOT NULL,
  action TEXT NOT NULL,
  yes_no TEXT NOT NULL,
  count INTEGER NOT NULL,
  maximum_price REAL NOT NULL,
  minimum_net_edge REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS risk_decisions (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  approved INTEGER NOT NULL,
  reason_codes_json TEXT NOT NULL,
  maximum_loss REAL NOT NULL,
  open_exposure_after REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_previews (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  average_price REAL NOT NULL,
  fees REAL NOT NULL,
  required_cash REAL NOT NULL,
  raw_response_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL,
  client_order_id TEXT NOT NULL UNIQUE,
  predarena_order_id TEXT,
  status TEXT NOT NULL,
  request_json TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS fills (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  price REAL NOT NULL,
  fee REAL NOT NULL,
  filled_at TEXT NOT NULL,
  stored_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settlements (
  id TEXT PRIMARY KEY,
  market_id TEXT NOT NULL,
  outcome TEXT NOT NULL,
  payout REAL NOT NULL,
  settled_at TEXT NOT NULL,
  stored_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS position_snapshots (
  id TEXT PRIMARY KEY,
  portfolio_snapshot_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  event_cluster_id TEXT NOT NULL,
  maximum_loss REAL NOT NULL,
  stored_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,
  cash REAL NOT NULL,
  open_exposure REAL NOT NULL,
  nav REAL NOT NULL,
  realized_pnl REAL NOT NULL,
  unrealized_pnl REAL NOT NULL,
  observed_at TEXT NOT NULL,
  stored_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_metrics (
  id TEXT PRIMARY KEY,
  metric_date TEXT NOT NULL UNIQUE,
  metrics_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  received_at TEXT NOT NULL,
  processed_at TEXT
);

CREATE TABLE IF NOT EXISTS system_runs (
  id TEXT PRIMARY KEY,
  run_key TEXT NOT NULL UNIQUE,
  run_type TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS reconciliation_events (
  id TEXT PRIMARY KEY,
  portfolio_hash TEXT NOT NULL,
  orders_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  details_json TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS daily_watchlist (
  market_date TEXT NOT NULL,
  market_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  venue TEXT NOT NULL,
  title TEXT NOT NULL,
  rank INTEGER NOT NULL,
  PRIMARY KEY (market_date, market_id)
);

CREATE TABLE IF NOT EXISTS groq_usage (
  usage_date TEXT NOT NULL,
  model TEXT NOT NULL,
  request_count INTEGER NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  remaining_requests INTEGER,
  remaining_tokens INTEGER,
  reset_requests TEXT,
  reset_tokens TEXT,
  PRIMARY KEY (usage_date, model)
);

CREATE TABLE IF NOT EXISTS quota_counters (
  period_key TEXT NOT NULL,
  quota_name TEXT NOT NULL,
  used INTEGER NOT NULL,
  PRIMARY KEY (period_key, quota_name)
);
