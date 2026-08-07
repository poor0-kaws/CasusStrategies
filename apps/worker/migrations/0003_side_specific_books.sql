ALTER TABLE market_snapshots ADD COLUMN yes_bid_depth_json TEXT;
ALTER TABLE market_snapshots ADD COLUMN yes_ask_depth_json TEXT;
ALTER TABLE market_snapshots ADD COLUMN no_bid_depth_json TEXT;
ALTER TABLE market_snapshots ADD COLUMN no_ask_depth_json TEXT;

ALTER TABLE daily_watchlist ADD COLUMN display_name TEXT;
ALTER TABLE daily_watchlist ADD COLUMN market_url TEXT;
ALTER TABLE daily_watchlist ADD COLUMN closes_at TEXT;
ALTER TABLE daily_watchlist ADD COLUMN displayed_price REAL;
ALTER TABLE daily_watchlist ADD COLUMN no_displayed_price REAL;
ALTER TABLE daily_watchlist ADD COLUMN volume REAL;
ALTER TABLE daily_watchlist ADD COLUMN liquidity REAL;
ALTER TABLE daily_watchlist ADD COLUMN minimum_order_size INTEGER;
ALTER TABLE daily_watchlist ADD COLUMN minimum_tick_size REAL;
