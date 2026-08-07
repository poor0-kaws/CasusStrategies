ALTER TABLE orders ADD COLUMN trading_date TEXT;
ALTER TABLE forecasts ADD COLUMN likelihood_ratios_json TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS system_state (
  state_key TEXT PRIMARY KEY,
  state_value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS model_cache (
  cache_key TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  response_json TEXT NOT NULL,
  quota_reliable INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edge_evaluations (
  intent_id TEXT PRIMARY KEY,
  conservative_edge REAL NOT NULL,
  passes_4_percent INTEGER NOT NULL,
  passes_6_percent INTEGER NOT NULL,
  passes_8_percent INTEGER NOT NULL,
  passes_10_percent INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_scenarios (
  intent_id TEXT PRIMARY KEY,
  contract_count INTEGER NOT NULL,
  observed_price REAL NOT NULL,
  fill_price REAL NOT NULL,
  fees REAL NOT NULL,
  one_tick_price REAL NOT NULL,
  three_tick_price REAL NOT NULL,
  one_second_price REAL,
  five_second_price REAL,
  assumes_maker_fill INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_trading_date ON orders(trading_date);
CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills(order_id);
