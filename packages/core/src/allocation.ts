import type { ResearchCategory } from "./schemas";

export interface SectorAllocation {
  category: ResearchCategory;
  percent: number;
}

export interface SectorPerformance {
  category: ResearchCategory;
  resolvedTrades: number;
  completedMonths: number;
  marketBrier: number;
  modelBrier: number;
  conservativePnl: number;
  deployedCapital: number;
  maxDrawdownPercent: number;
}

const categoryOrder: ResearchCategory[] = [
  "weather",
  "economics",
  "public_policy",
  "legal_regulatory",
  "corporate_events",
];

const basePercent: Record<ResearchCategory, number> = {
  weather: 30,
  economics: 25,
  public_policy: 15,
  legal_regulatory: 15,
  corporate_events: 15,
};

const bounds: Record<ResearchCategory, { minimum: number; maximum: number }> = {
  weather: { minimum: 20, maximum: 35 },
  economics: { minimum: 20, maximum: 35 },
  public_policy: { minimum: 10, maximum: 20 },
  legal_regulatory: { minimum: 10, maximum: 20 },
  corporate_events: { minimum: 10, maximum: 20 },
};

export const BASE_SECTOR_ALLOCATION: SectorAllocation[] = categoryOrder.map((category) => ({
  category,
  percent: basePercent[category],
}));

export function calculateAdaptiveAllocation(
  performance: SectorPerformance[],
  currentAllocation: SectorAllocation[] = BASE_SECTOR_ALLOCATION,
): SectorAllocation[] {
  const performanceByCategory = new Map(performance.map((item) => [item.category, item]));
  const currentByCategory = new Map(currentAllocation.map((item) => [item.category, item.percent]));
  const proposed = categoryOrder.map((category) => {
    const metrics = performanceByCategory.get(category);
    const currentPercent = currentByCategory.get(category) ?? basePercent[category];
    if (!metrics || metrics.resolvedTrades < 30 || metrics.completedMonths < 3) {
      return { category, percent: currentPercent };
    }

    const sampleWeight = Math.min(metrics.resolvedTrades / 100, 1);
    const marketBrier = Math.max(metrics.marketBrier, 0.01);
    const calibrationSkill = clamp((metrics.marketBrier - metrics.modelBrier) / marketBrier, -1, 1);
    const returnRate =
      metrics.deployedCapital > 0 ? metrics.conservativePnl / metrics.deployedCapital : 0;
    const returnQuality = clamp(returnRate / 0.1, -1, 1);
    const drawdownQuality = clamp(1 - metrics.maxDrawdownPercent / 5, -1, 1);
    const quality = calibrationSkill * 0.4 + returnQuality * 0.4 + drawdownQuality * 0.2;
    const adjustment = 5 * sampleWeight * quality;
    const limit = bounds[category];

    return {
      category,
      percent: clamp(currentPercent + adjustment, limit.minimum, limit.maximum),
    };
  });

  return normalizeWithinBounds(proposed);
}

function normalizeWithinBounds(allocation: SectorAllocation[]): SectorAllocation[] {
  const result = allocation.map((item) => ({ ...item }));

  for (let pass = 0; pass < 10; pass += 1) {
    const total = result.reduce((sum, item) => sum + item.percent, 0);
    const difference = 100 - total;
    if (Math.abs(difference) < 0.000_001) {
      break;
    }

    const eligible = result.filter((item) => {
      const limit = bounds[item.category];
      return difference > 0 ? item.percent < limit.maximum : item.percent > limit.minimum;
    });
    if (eligible.length === 0) {
      break;
    }

    const change = difference / eligible.length;
    for (const item of eligible) {
      const limit = bounds[item.category];
      item.percent = clamp(item.percent + change, limit.minimum, limit.maximum);
    }
  }

  const rounded = result.map((item) => ({ ...item, percent: round(item.percent, 4) }));
  const residual = round(100 - rounded.reduce((sum, item) => sum + item.percent, 0), 4);
  const recipient = rounded.find((item) => {
    const limit = bounds[item.category];
    const adjusted = item.percent + residual;
    return adjusted >= limit.minimum && adjusted <= limit.maximum;
  });
  if (recipient) {
    recipient.percent = round(recipient.percent + residual, 4);
  }

  return rounded;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, places: number): number {
  const multiplier = 10 ** places;
  return Math.round(value * multiplier) / multiplier;
}
