export interface Env {
  RESEARCH_DB: D1Database;
  FUND_COORDINATOR: DurableObjectNamespace;
  PREDARENA_API_KEY: string;
  PREDARENA_WEBHOOK_SECRET: string;
  GROQ_API_KEY: string;
  PREDARENA_BASE_URL: string;
  GROQ_BASE_URL: string;
  GROQ_MODEL_TRIAGE: string;
  GROQ_MODEL_CONTRACT: string;
  GROQ_MODEL_EVIDENCE: string;
  GROQ_MODEL_SKEPTIC: string;
  TRADING_MODE: "shadow" | "paper";
  GITHUB_REPORTS_TOKEN: string;
  GITHUB_REPOSITORY: string;
  GITHUB_REPORTS_BRANCH: string;
  REPORT_PATH: string;
  FUND_INCEPTION_DATE: string;
  FUND_STARTING_NAV: string;
}

export function isPaperTradingEnabled(env: Env): boolean {
  return env.TRADING_MODE === "paper";
}
