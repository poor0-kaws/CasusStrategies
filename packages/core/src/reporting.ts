import type { MonthlyReport } from "./schemas";

function requirePositiveNav(nav: number, name: string): void {
  if (!Number.isFinite(nav) || nav <= 0) {
    throw new RangeError(`${name} must be greater than 0`);
  }
}

export function calculateMonthlyReturn(openingNav: number, closingNav: number): number {
  requirePositiveNav(openingNav, "openingNav");
  if (!Number.isFinite(closingNav) || closingNav < 0) {
    throw new RangeError("closingNav must be non-negative");
  }

  return (closingNav / openingNav - 1) * 100;
}

export function calculateOverallReturn(startingNav: number, currentNav: number): number {
  requirePositiveNav(startingNav, "startingNav");
  if (!Number.isFinite(currentNav) || currentNav < 0) {
    throw new RangeError("currentNav must be non-negative");
  }

  return (currentNav / startingNav - 1) * 100;
}

export function getLatestSixReports(reports: MonthlyReport[]): MonthlyReport[] {
  return [...reports].sort((left, right) => right.month.localeCompare(left.month)).slice(0, 6);
}

export function buildMonthlyReport(
  month: string,
  openingNav: number,
  closingNav: number,
): MonthlyReport {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new RangeError("month must use YYYY-MM format");
  }

  return {
    month,
    closingNav,
    returnPercent: calculateMonthlyReturn(openingNav, closingNav),
  };
}
