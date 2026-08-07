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

    expect(report.months).toEqual([{ period: "2026-07", closingNav: 1_050 }]);
    expect(report.asOf).toBe("2026-07-31");
    expect(report.status).toBe("official");
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
});

describe("GitHubReportPublisher", () => {
  const illustrative: PublicFundReport = {
    fundName: "Casus Strategies",
    startingNav: 1_000,
    inceptionDate: "2026-01-01",
    asOf: "2026-01-31",
    status: "illustrative",
    months: [{ period: "2026-01", closingNav: 1_020 }],
  };

  it("replaces illustrative data with a sanitized official JSON file", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          sha: "current-file-sha",
          encoding: "base64",
          content: encodeTestReport(illustrative),
        }),
      )
      .mockResolvedValueOnce(Response.json({ commit: { sha: "commit-123" } }));
    const publisher = createPublisher(fetcher);

    const result = await publisher.publish({
      ...illustrative,
      inceptionDate: "2026-07-01",
      asOf: "2026-07-31",
      status: "official",
      months: [{ period: "2026-07", closingNav: 1_050 }],
    });

    expect(result.commitSha).toBe("commit-123");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const update = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as {
      content: string;
      sha: string;
    };
    const published = JSON.parse(atob(update.content)) as Record<string, unknown>;
    expect(update.sha).toBe("current-file-sha");
    expect(Object.keys(published).sort()).toEqual(
      ["asOf", "fundName", "inceptionDate", "months", "startingNav", "status"].sort(),
    );
    expect(published).toMatchObject({
      status: "official",
      months: [{ period: "2026-07", closingNav: 1_050 }],
    });
  });

  it("does not attempt an update when the current public file cannot be verified", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("unavailable", { status: 503 }));
    const publisher = createPublisher(fetcher);

    await expect(publisher.publish(illustrative)).rejects.toThrow(
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

function encodeTestReport(report: PublicFundReport): string {
  return btoa(JSON.stringify(report));
}
