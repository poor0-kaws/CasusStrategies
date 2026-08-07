import { describe, expect, it } from "vitest";

import { fundReport } from "./data/fund-report";
import generatedReport from "./data/generated/fund-report.json";
import {
  calculateMonthlyReturns,
  calculateTotalReturn,
  getLatestMonthlyReturns,
} from "./reporting";

describe("fund reporting", () => {
  it("keeps the generated public file free of private portfolio fields", () => {
    expect(Object.keys(generatedReport).sort()).toEqual(
      ["asOf", "fundName", "inceptionDate", "months", "startingNav", "status"].sort(),
    );
    expect(JSON.stringify(generatedReport)).not.toMatch(/position|trade|reason|realized|agent/i);
  });

  it("calculates each month from the previous month-end NAV", () => {
    const returns = calculateMonthlyReturns(fundReport);

    expect(returns[0].returnPercent).toBeCloseTo(1.8, 5);
    expect(returns[1].returnPercent).toBeCloseTo(-0.5, 1);
  });

  it("keeps exactly the latest six monthly reports", () => {
    const latest = getLatestMonthlyReturns(fundReport);

    expect(latest).toHaveLength(6);
    expect(latest[0].period).toBe("2026-02");
    expect(latest.at(-1)?.period).toBe("2026-07");
  });

  it("calculates total return from the original one-thousand-dollar NAV", () => {
    expect(calculateTotalReturn(fundReport)).toBeCloseTo(8.862, 3);
  });
});
