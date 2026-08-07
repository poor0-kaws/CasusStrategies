import { describe, expect, it } from "vitest";

import {
  BASE_SECTOR_ALLOCATION,
  calculateAdaptiveAllocation,
  type SectorPerformance,
} from "../src";

describe("adaptive sector allocation", () => {
  it("uses the approved base weights until enough outcomes exist", () => {
    expect(calculateAdaptiveAllocation([])).toEqual(BASE_SECTOR_ALLOCATION);
    expect(
      calculateAdaptiveAllocation([
        performance({ category: "weather", resolvedTrades: 29, completedMonths: 12 }),
      ]),
    ).toEqual(BASE_SECTOR_ALLOCATION);
  });

  it("tilts toward calibrated returns without breaking sector bounds", () => {
    const allocation = calculateAdaptiveAllocation([
      performance({
        category: "weather",
        modelBrier: 0.12,
        conservativePnl: 12,
        maxDrawdownPercent: 1,
      }),
      performance({
        category: "economics",
        modelBrier: 0.28,
        conservativePnl: -8,
        maxDrawdownPercent: 9,
      }),
    ]);

    const byCategory = new Map(allocation.map((item) => [item.category, item.percent]));
    expect(byCategory.get("weather")).toBeGreaterThan(30);
    expect(byCategory.get("economics")).toBeLessThan(25);
    expect(byCategory.get("weather")).toBeLessThanOrEqual(35);
    expect(byCategory.get("economics")).toBeGreaterThanOrEqual(20);
    expect(allocation.reduce((sum, item) => sum + item.percent, 0)).toBeCloseTo(100, 4);
  });

  it("moves each eligible sector by no more than five points from its current weight", () => {
    const current = BASE_SECTOR_ALLOCATION.map((item) =>
      item.category === "weather" ? { ...item, percent: 32 } : { ...item },
    );
    current.find((item) => item.category === "corporate_events")!.percent = 13;
    const allocation = calculateAdaptiveAllocation(
      [performance({ category: "weather", modelBrier: 0.05, conservativePnl: 50 })],
      current,
    );
    const weather = allocation.find((item) => item.category === "weather")!;

    expect(weather.percent).toBeGreaterThanOrEqual(32);
    expect(weather.percent).toBeLessThanOrEqual(35);
  });
});

function performance(overrides: Partial<SectorPerformance>): SectorPerformance {
  return {
    category: "weather",
    resolvedTrades: 100,
    completedMonths: 3,
    marketBrier: 0.22,
    modelBrier: 0.2,
    conservativePnl: 0,
    deployedCapital: 100,
    maxDrawdownPercent: 5,
    ...overrides,
  };
}
