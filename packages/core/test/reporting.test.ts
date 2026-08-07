import { describe, expect, it } from "vitest";

import {
  buildMonthlyReport,
  calculateMonthlyReturn,
  calculateOverallReturn,
  getLatestSixReports,
} from "../src";

describe("public reporting math", () => {
  it("calculates monthly and overall percentage returns", () => {
    expect(calculateMonthlyReturn(1_000, 1_050)).toBeCloseTo(5);
    expect(calculateOverallReturn(1_000, 1_125)).toBeCloseTo(12.5);
  });

  it("keeps only the latest six monthly tiles", () => {
    const reports = [
      buildMonthlyReport("2026-01", 1_000, 1_010),
      buildMonthlyReport("2026-02", 1_010, 1_020),
      buildMonthlyReport("2026-03", 1_020, 1_030),
      buildMonthlyReport("2026-04", 1_030, 1_040),
      buildMonthlyReport("2026-05", 1_040, 1_050),
      buildMonthlyReport("2026-06", 1_050, 1_060),
      buildMonthlyReport("2026-07", 1_060, 1_070),
    ];

    const latest = getLatestSixReports(reports);

    expect(latest).toHaveLength(6);
    expect(latest[0]?.month).toBe("2026-07");
    expect(latest.at(-1)?.month).toBe("2026-02");
  });
});
