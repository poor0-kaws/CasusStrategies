CREATE TABLE IF NOT EXISTS report_publications (
  period TEXT PRIMARY KEY,
  report_hash TEXT NOT NULL,
  github_commit_sha TEXT NOT NULL,
  published_at TEXT NOT NULL
);
