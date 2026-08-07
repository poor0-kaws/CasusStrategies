import { describe, expect, it, vi } from "vitest";

import {
  buildDailyEvaluation,
  buildOfficialReport,
  GitHubReportPublisher,
  previousNewYorkPeriod,
  ReportingService,
  type PublicFundReport,
} from "../src/reporting";
import type { ResearchStore, StoredPortfolioSnapshot } from "../src/store/research-store";

const julySnapshot: StoredPortfolioSnapshot = {
  cash: 850,
  nav: 1_050,
  openExposure: 150,
  realizedPnl: 30,
  unrealizedPnl: 20,
  positions: [],
  observedAt: "2026-08-01T03:55:00.000Z",
};

describe("monthly reporting", () => {
  it("uses New York calendar boundaries, including the January rollover", () => {
    expect(previousNewYorkPeriod(new Date("2026-08-01T12:00:00.000Z"))).toBe("2026-07");
    expect(previousNewYorkPeriod(new Date("2026-01-01T13:00:00.000Z"))).toBe("2025-12");
  });

  it("selects the final New York snapshot and excludes the current month", () => {
    const report = buildOfficialReport({
      snapshots: [
        { ...julySnapshot, nav: 1_040, observedAt: "2026-07-31T18:00:00.000Z" },
        julySnapshot,
        { ...julySnapshot, nav: 1_070, observedAt: "2026-08-01T04:05:00.000Z" },
      ],
      completedPeriod: "2026-07",
      startingNav: 1_000,
      inceptionDate: "2026-07-01",
    });

    expect(report.liveMonths).toEqual([{ period: "2026-07", closingNav: 1_050 }]);
    expect(report.asOf).toBe("2026-07-31");
    expect(report.liveInceptionDate).toBe("2026-07-01");
    expect(report.backtestMonths).toHaveLength(6);
  });

  it("records official daily NAV without inventing unavailable private estimates", () => {
    const evaluation = buildDailyEvaluation({
      portfolio: julySnapshot,
      metricDate: "2026-07-31",
      mode: "paper",
      startingNav: 1_000,
      orderCount: 2,
      signalExecutionCost: 3,
      conservativeExecutionPenalty: 4,
    });

    expect(evaluation).toMatchObject({
      officialNav: 1_050,
      officialPnl: 50,
      overallReturnPercent: 5,
      orderCount: 2,
      signalPnl: 53,
      conservativePnl: 46,
    });
  });

  it("keeps shadow evaluation private and never calls the publisher", async () => {
    const saveDailyEvaluation = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn();
    const store = {
      latestReconciliationStatus: vi.fn().mockResolvedValue("matched"),
      listPortfolioSnapshots: vi.fn().mockResolvedValue([julySnapshot]),
      countOrdersForDate: vi.fn().mockResolvedValue(0),
      getPrivatePerformanceAdjustments: vi.fn().mockResolvedValue({
        signalExecutionCost: 0,
        conservativeExecutionPenalty: 0,
      }),
      saveDailyEvaluation,
    } as unknown as ResearchStore;
    const service = new ReportingService({
      store,
      publisher: { publish } as unknown as GitHubReportPublisher,
      startingNav: 1_000,
      inceptionDate: "not-active-yet",
    });

    await expect(
      service.evaluateAndPublish(new Date("2026-08-01T12:00:00.000Z"), "shadow"),
    ).resolves.toEqual({ evaluation: "saved", publication: "shadow" });
    expect(saveDailyEvaluation).toHaveBeenCalledOnce();
    expect(publish).not.toHaveBeenCalled();
  });

  it("calculates and stores aggregate sector weights before month-end publication", async () => {
    const saveSectorAllocation = vi.fn().mockResolvedValue(undefined);
    const publish = vi.fn().mockResolvedValue({ commitSha: "commit-1", reportHash: "hash-1" });
    const store = {
      latestReconciliationStatus: vi.fn().mockResolvedValue("matched"),
      listPortfolioSnapshots: vi.fn().mockResolvedValue([julySnapshot]),
      countOrdersForDate: vi.fn().mockResolvedValue(0),
      getPrivatePerformanceAdjustments: vi.fn().mockResolvedValue({
        signalExecutionCost: 0,
        conservativeExecutionPenalty: 0,
      }),
      saveDailyEvaluation: vi.fn(),
      hasPublishedReport: vi.fn().mockResolvedValue(false),
      getSectorPerformance: vi.fn().mockResolvedValue([]),
      getLatestSectorAllocation: vi.fn().mockResolvedValue(null),
      saveSectorAllocation,
      recordPublishedReport: vi.fn(),
    } as unknown as ResearchStore;
    const service = new ReportingService({
      store,
      publisher: { publish } as unknown as GitHubReportPublisher,
      startingNav: 1_000,
      inceptionDate: "2026-07-01",
    });

    await expect(
      service.evaluateAndPublish(new Date("2026-08-01T12:00:00.000Z"), "paper"),
    ).resolves.toMatchObject({ publication: "published", period: "2026-07" });
    expect(saveSectorAllocation).toHaveBeenCalledWith(
      "2026-07",
      expect.arrayContaining([expect.objectContaining({ category: "weather", percent: 30 })]),
      [],
      expect.any(String),
    );
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        sectorAllocation: expect.arrayContaining([
          expect.objectContaining({ category: "economics", percent: 25 }),
        ]),
      }),
    );
  });
});

describe("GitHubReportPublisher", () => {
  const legacyIllustrative = {
    fundName: "Casus Strategies",
    startingNav: 1_000,
    inceptionDate: "2026-01-01",
    asOf: "2026-01-31",
    status: "illustrative",
    months: [{ period: "2026-01", closingNav: 1_020 }],
  };

  const liveReport: PublicFundReport = {
    schemaVersion: 2,
    fundName: "Casus Strategies",
    startingNav: 1_000,
    liveInceptionDate: "2026-07-01",
    asOf: "2026-07-31",
    backtestMonths: [
      { period: "2026-02", returnPercent: -0.5 },
      { period: "2026-03", returnPercent: 2.8 },
      { period: "2026-04", returnPercent: 1.1 },
      { period: "2026-05", returnPercent: -0.7 },
      { period: "2026-06", returnPercent: 2.6 },
      { period: "2026-07", returnPercent: 1.5 },
    ],
    liveMonths: [{ period: "2026-07", closingNav: 1_050 }],
    sectorAllocation: [
      { category: "weather", percent: 30 },
      { category: "economics", percent: 25 },
      { category: "public_policy", percent: 15 },
      { category: "legal_regulatory", percent: 15 },
      { category: "corporate_events", percent: 15 },
    ],
  };

  it("replaces illustrative data with a sanitized official JSON file", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          sha: "current-file-sha",
          encoding: "base64",
          content: encodeTestReport(legacyIllustrative),
        }),
      )
      .mockResolvedValueOnce(Response.json({ commit: { sha: "commit-123" } }));
    const publisher = createPublisher(fetcher);

    const result = await publisher.publish(liveReport);

    expect(result.commitSha).toBe("commit-123");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const update = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as {
      content: string;
      sha: string;
    };
    const published = JSON.parse(atob(update.content)) as Record<string, unknown>;
    expect(update.sha).toBe("current-file-sha");
    expect(Object.keys(published).sort()).toEqual(
      [
        "asOf",
        "backtestMonths",
        "fundName",
        "liveInceptionDate",
        "liveMonths",
        "schemaVersion",
        "sectorAllocation",
        "startingNav",
      ].sort(),
    );
    expect(published).toMatchObject({
      schemaVersion: 2,
      liveMonths: [{ period: "2026-07", closingNav: 1_050 }],
    });
  });

  it("does not attempt an update when the current public file cannot be verified", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    const publisher = createPublisher(fetcher);

    await expect(publisher.publish(liveReport)).rejects.toThrow(
      "GitHub current report lookup failed",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

function createPublisher(fetcher: typeof fetch): GitHubReportPublisher {
  return new GitHubReportPublisher({
    token: "test-token",
    repository: "casus/strategies",
    branch: "main",
    reportPath: "apps/web/src/data/generated/fund-report.json",
    fetcher,
  });
}

function encodeTestReport(report: unknown): string {
  return btoa(JSON.stringify(report));
}
