import { z } from "zod";

import type { PaperPortfolio } from "./contracts";
import { sha256Hex } from "./crypto";
import type { ResearchStore, StoredPortfolioSnapshot } from "./store/research-store";

const NEW_YORK_TIME_ZONE = "America/New_York";

const MonthEndRecordSchema = z
  .object({
    period: z.string().regex(/^\d{4}-\d{2}$/),
    closingNav: z.number().nonnegative().finite(),
  })
  .strict();

export const PublicFundReportSchema = z
  .object({
    fundName: z.literal("Casus Strategies"),
    startingNav: z.number().positive().finite(),
    inceptionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    status: z.enum(["illustrative", "official"]),
    months: z.array(MonthEndRecordSchema),
  })
  .strict();

export type PublicFundReport = z.infer<typeof PublicFundReportSchema>;

export interface GitHubReportPublisherOptions {
  token: string;
  repository: string;
  branch: string;
  reportPath: string;
  fetcher?: typeof fetch;
}

export interface ReportingServiceOptions {
  store: ResearchStore;
  publisher: GitHubReportPublisher;
  startingNav: number;
  inceptionDate: string;
}

export interface ReportingResult {
  evaluation: "saved";
  publication: "not_due" | "shadow" | "already_published" | "published";
  period?: string;
}

interface GitHubFile {
  sha: string;
  content: string;
  encoding: "base64";
}

// This service turns private reconciled snapshots into one daily record and a tiny public report.
export class ReportingService {
  private readonly store: ResearchStore;
  private readonly publisher: GitHubReportPublisher;
  private readonly startingNav: number;
  private readonly inceptionDate: string;

  constructor(options: ReportingServiceOptions) {
    this.store = options.store;
    this.publisher = options.publisher;
    this.startingNav = requireStartingNav(options.startingNav);
    this.inceptionDate = options.inceptionDate;
  }

  async evaluateAndPublish(now: Date, mode: "shadow" | "paper"): Promise<ReportingResult> {
    if ((await this.store.latestReconciliationStatus()) !== "matched") {
      throw new Error("A matched PredArena reconciliation is required before evaluation");
    }
    const snapshots = await this.store.listPortfolioSnapshots();
    const latest = snapshots.at(-1);
    if (!latest) {
      throw new Error("A reconciled PredArena snapshot is required before evaluation");
    }

    const metricDate = newYorkDate(now);
    const orderCount = await this.store.countOrdersForDate(metricDate);
    const adjustments = await this.store.getPrivatePerformanceAdjustments();
    await this.store.saveDailyEvaluation(
      buildDailyEvaluation({
        portfolio: latest,
        metricDate,
        mode,
        startingNav: this.startingNav,
        orderCount,
        signalExecutionCost: adjustments.signalExecutionCost,
        conservativeExecutionPenalty: adjustments.conservativeExecutionPenalty,
      }),
      now.toISOString(),
    );

    if (mode === "shadow") {
      return { evaluation: "saved", publication: "shadow" };
    }

    requireInceptionDate(this.inceptionDate);
    const completedPeriod = previousNewYorkPeriod(now);
    if (completedPeriod < this.inceptionDate.slice(0, 7)) {
      return { evaluation: "saved", publication: "not_due", period: completedPeriod };
    }
    if (await this.store.hasPublishedReport(completedPeriod)) {
      return {
        evaluation: "saved",
        publication: "already_published",
        period: completedPeriod,
      };
    }

    const report = buildOfficialReport({
      snapshots,
      completedPeriod,
      startingNav: this.startingNav,
      inceptionDate: this.inceptionDate,
    });
    if (!report.months.some((month) => month.period === completedPeriod)) {
      throw new Error(`No reconciled PredArena snapshot exists for ${completedPeriod}`);
    }

    const published = await this.publisher.publish(report);
    await this.store.recordPublishedReport({
      period: completedPeriod,
      reportHash: published.reportHash,
      githubCommitSha: published.commitSha,
      publishedAt: now.toISOString(),
    });

    return { evaluation: "saved", publication: "published", period: completedPeriod };
  }
}

// Only this class can replace the generated public report in GitHub.
export class GitHubReportPublisher {
  private readonly token: string;
  private readonly repository: string;
  private readonly branch: string;
  private readonly reportPath: string;
  private readonly fetcher: typeof fetch;

  constructor(options: GitHubReportPublisherOptions) {
    this.token = options.token;
    this.repository = requireRepository(options.repository);
    this.branch = requireText(options.branch, "GitHub report branch");
    this.reportPath = requireText(options.reportPath, "GitHub report path");
    this.fetcher = options.fetcher ?? fetch;
  }

  async publish(candidate: PublicFundReport): Promise<{ commitSha: string; reportHash: string }> {
    if (!this.token) {
      throw new Error("GITHUB_REPORTS_TOKEN is missing");
    }

    const currentFile = await this.getCurrentFile();
    const currentReport = parseEncodedReport(currentFile);
    const report = mergeOfficialHistory(currentReport, candidate);
    const serialized = `${JSON.stringify(PublicFundReportSchema.parse(report), null, 2)}\n`;
    const url = this.contentsUrl();
    const response = await this.fetcher(url, {
      method: "PUT",
      headers: this.headers(),
      body: JSON.stringify({
        message: `Publish Casus Strategies report through ${report.asOf}`,
        content: encodeBase64(serialized),
        sha: currentFile.sha,
        branch: this.branch,
      }),
    });
    if (!response.ok) {
      throw new Error(`GitHub report update failed with status ${response.status}`);
    }

    const body = (await response.json()) as { commit?: { sha?: unknown } };
    const commitSha = body.commit?.sha;
    if (typeof commitSha !== "string" || commitSha.length === 0) {
      throw new Error("GitHub report update did not return a commit SHA");
    }

    return { commitSha, reportHash: await sha256Hex(serialized) };
  }

  private async getCurrentFile(): Promise<GitHubFile> {
    const response = await this.fetcher(
      `${this.contentsUrl()}?ref=${encodeURIComponent(this.branch)}`,
      { headers: this.headers() },
    );
    if (!response.ok) {
      throw new Error(`GitHub current report lookup failed with status ${response.status}`);
    }

    const body = (await response.json()) as Partial<GitHubFile>;
    if (body.encoding !== "base64" || typeof body.sha !== "string" || !body.content) {
      throw new Error("GitHub current report response is incomplete");
    }
    return { sha: body.sha, content: body.content, encoding: body.encoding };
  }

  private contentsUrl(): string {
    const path = this.reportPath
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/");
    return `https://api.github.com/repos/${this.repository}/contents/${path}`;
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "casus-strategies-worker",
    };
  }
}

export function buildDailyEvaluation(input: {
  portfolio: PaperPortfolio & { observedAt: string };
  metricDate: string;
  mode: "shadow" | "paper";
  startingNav: number;
  orderCount: number;
  signalExecutionCost: number;
  conservativeExecutionPenalty: number;
}) {
  const officialPnl = input.portfolio.nav - input.startingNav;
  return {
    metricDate: input.metricDate,
    mode: input.mode,
    officialNav: input.portfolio.nav,
    officialPnl,
    cash: input.portfolio.cash,
    openExposure: input.portfolio.openExposure,
    realizedPnl: input.portfolio.realizedPnl,
    unrealizedPnl: input.portfolio.unrealizedPnl,
    overallReturnPercent: (officialPnl / input.startingNav) * 100,
    positionCount: input.portfolio.positions.length,
    orderCount: input.orderCount,
    signalPnl: officialPnl + input.signalExecutionCost,
    conservativePnl: officialPnl - input.conservativeExecutionPenalty,
    observedAt: input.portfolio.observedAt,
  };
}

export function buildOfficialReport(input: {
  snapshots: StoredPortfolioSnapshot[];
  completedPeriod: string;
  startingNav: number;
  inceptionDate: string;
}): PublicFundReport {
  const latestByPeriod = new Map<string, StoredPortfolioSnapshot>();

  for (const snapshot of input.snapshots) {
    if (snapshot.observedAt < input.inceptionDate) {
      continue;
    }
    const period = newYorkPeriod(new Date(snapshot.observedAt));
    if (period > input.completedPeriod) {
      continue;
    }
    const current = latestByPeriod.get(period);
    if (!current || snapshot.observedAt > current.observedAt) {
      latestByPeriod.set(period, snapshot);
    }
  }

  const months = [...latestByPeriod.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([period, snapshot]) => ({ period, closingNav: snapshot.nav }));

  return PublicFundReportSchema.parse({
    fundName: "Casus Strategies",
    startingNav: input.startingNav,
    inceptionDate: input.inceptionDate,
    asOf: periodEndDate(input.completedPeriod),
    status: "official",
    months,
  });
}

export function previousNewYorkPeriod(now: Date): string {
  const current = newYorkPeriod(now);
  const [yearText, monthText] = current.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

function mergeOfficialHistory(
  current: PublicFundReport,
  candidate: PublicFundReport,
): PublicFundReport {
  if (current.status === "illustrative") {
    return PublicFundReportSchema.parse(candidate);
  }
  if (
    current.startingNav !== candidate.startingNav ||
    current.inceptionDate !== candidate.inceptionDate
  ) {
    throw new Error("Published inception data does not match the reconciled report");
  }

  const months = new Map(current.months.map((month) => [month.period, month]));
  for (const month of candidate.months) {
    const published = months.get(month.period);
    if (published && Math.abs(published.closingNav - month.closingNav) > 0.000_001) {
      throw new Error(`Published NAV for ${month.period} cannot be rewritten`);
    }
    months.set(month.period, month);
  }

  return PublicFundReportSchema.parse({
    ...candidate,
    months: [...months.values()].sort((left, right) => left.period.localeCompare(right.period)),
  });
}

function parseEncodedReport(file: GitHubFile): PublicFundReport {
  try {
    return PublicFundReportSchema.parse(JSON.parse(decodeBase64(file.content)));
  } catch {
    throw new Error("Existing public report is invalid; refusing to replace it");
  }
}

function newYorkDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: NEW_YORK_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function newYorkPeriod(now: Date): string {
  return newYorkDate(now).slice(0, 7);
}

function periodEndDate(period: string): string {
  const [yearText, monthText] = period.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText), 0));
  return date.toISOString().slice(0, 10);
}

function requireStartingNav(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("FUND_STARTING_NAV must be a positive number");
  }
  return value;
}

function requireInceptionDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("FUND_INCEPTION_DATE must use YYYY-MM-DD");
  }
  return value;
}

function requireRepository(value: string): string {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("GITHUB_REPOSITORY must use owner/repository");
  }
  return value;
}

function requireText(value: string, label: string): string {
  if (!value.trim()) {
    throw new Error(`${label} is missing`);
  }
  return value;
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
}
