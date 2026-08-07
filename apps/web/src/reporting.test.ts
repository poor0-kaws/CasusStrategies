// This file verifies that historical months and append-only live months are displayed correctly.

import { describe, expect, it } from "vitest";

import { fundReport, type PublicFundReportV2 } from "./data/fund-report";
import generatedReport from "./data/generated/fund-report.json";
import {
  calculateLiveMonthlyReturns,
  calculateTotalReturn,
  getLatestMonthlyReturns,
  getLiveProgression,
} from "./reporting";

describe("fund reporting", () => {
  it("keeps the generated public file small and free of private records", () => {
    expect(Object.keys(generatedReport).sort()).toEqual(
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
    expect(JSON.stringify(generatedReport)).not.toMatch(
      /position|trade|reason|realized|agent|prompt/i,
    );
  });

  it("starts with the approved February through July historical record", () => {
    const returns = getLatestMonthlyReturns(fundReport);

    expect(returns.map((month) => month.returnPercent)).toEqual([-0.5, 2.8, 1.1, -0.7, 2.6, 1.5]);
    expect(returns[0]?.period).toBe("2026-02");
    expect(returns.at(-1)?.period).toBe("2026-07");
  });

  it("lets a verified August close replace February in the rolling six", () => {
    const report = withLiveMonths([{ period: "2026-08", closingNav: 1_010 }]);
    const latest = getLatestMonthlyReturns(report);

    expect(latest).toHaveLength(6);
    expect(latest[0]?.period).toBe("2026-03");
    expect(latest.at(-1)).toMatchObject({ period: "2026-08", recordType: "live" });
  });

  it("uses a live record when it shares a month with a historical result", () => {
    const report = withLiveMonths([{ period: "2026-07", closingNav: 1_020 }]);
    const july = getLatestMonthlyReturns(report).find((month) => month.period === "2026-07");

    expect(july?.recordType).toBe("live");
    expect(july?.returnPercent).toBeCloseTo(2, 8);
  });

  it("keeps NAV and the progression chart empty until a live month closes", () => {
    expect(calculateLiveMonthlyReturns(fundReport)).toEqual([]);
    expect(getLiveProgression(fundReport)).toEqual([]);
    expect(calculateTotalReturn(fundReport)).toBe(0);
  });

  it("charts only the inception anchor and verified live months", () => {
    const report = withLiveMonths([{ period: "2026-08", closingNav: 1_010 }]);
    const progression = getLiveProgression(report);

    expect(progression).toHaveLength(2);
    expect(progression[0]).toMatchObject({ label: "Inception", closingNav: 1_000 });
    expect(progression[1]?.period).toBe("2026-08");
    expect(progression[1]?.cumulativeReturnPercent).toBeCloseTo(1, 8);
  });
});

function withLiveMonths(liveMonths: PublicFundReportV2["liveMonths"]): PublicFundReportV2 {
  return {
    ...fundReport,
    liveInceptionDate: "2026-08-01",
    asOf: "2026-08-31",
    liveMonths,
  };
}
