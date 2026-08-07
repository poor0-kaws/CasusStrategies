ALTER TABLE trade_intents ADD COLUMN category TEXT;
ALTER TABLE trade_intents ADD COLUMN event_cluster_id TEXT;
ALTER TABLE trade_intents ADD COLUMN hedge_plan_id TEXT;

ALTER TABLE risk_decisions ADD COLUMN gross_exposure_after REAL;
ALTER TABLE risk_decisions ADD COLUMN sector_exposure_after REAL;
ALTER TABLE risk_decisions ADD COLUMN scenario_loss_after REAL;

CREATE TABLE IF NOT EXISTS hedge_plans (
  id TEXT PRIMARY KEY,
  event_cluster_id TEXT NOT NULL,
  strategy TEXT NOT NULL,
  relationship_ids_json TEXT NOT NULL,
  pre_hedge_scenario_loss REAL NOT NULL,
  post_hedge_scenario_loss REAL NOT NULL,
  maximum_orphan_loss REAL NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hedge_plan_legs (
  hedge_plan_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  leg_index INTEGER NOT NULL,
  status TEXT NOT NULL,
  PRIMARY KEY (hedge_plan_id, intent_id)
);

CREATE TABLE IF NOT EXISTS scenario_risk_snapshots (
  id TEXT PRIMARY KEY,
  event_cluster_id TEXT NOT NULL,
  gross_deployed REAL NOT NULL,
  worst_case_loss REAL NOT NULL,
  scenarios_json TEXT NOT NULL,
  observed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sector_allocations (
  period TEXT NOT NULL,
  category TEXT NOT NULL,
  percent REAL NOT NULL,
  inputs_json TEXT NOT NULL,
  calculated_at TEXT NOT NULL,
  PRIMARY KEY (period, category)
);

CREATE INDEX IF NOT EXISTS idx_trade_intents_category
  ON trade_intents(category, created_at);
CREATE INDEX IF NOT EXISTS idx_hedge_plans_cluster
  ON hedge_plans(event_cluster_id, created_at);
