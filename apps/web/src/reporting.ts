// This file combines historical model months with append-only live months for public display.

import type { LiveMonth, PublicFundReportV2 } from "./data/fund-report";

export interface MonthlyReturn {
  period: string;
  returnPercent: number;
  recordType: "backtest" | "live";
}

export interface LiveProgressPoint extends LiveMonth {
  label: string;
  cumulativeReturnPercent: number;
}

export function calculateLiveMonthlyReturns(report: PublicFundReportV2): MonthlyReturn[] {
  return report.liveMonths.map((month, index) => {
    const previousNav = index === 0 ? report.startingNav : report.liveMonths[index - 1]!.closingNav;
    return {
      period: month.period,
      returnPercent: (month.closingNav / previousNav - 1) * 100,
      recordType: "live",
    };
  });
}

export function getLatestMonthlyReturns(report: PublicFundReportV2, count = 6): MonthlyReturn[] {
  if (count <= 0) {
    return [];
  }

  const records = new Map<string, MonthlyReturn>();
  for (const month of report.backtestMonths) {
    records.set(month.period, { ...month, recordType: "backtest" });
  }
  for (const month of calculateLiveMonthlyReturns(report)) {
    records.set(month.period, month);
  }

  return [...records.values()]
    .sort((left, right) => left.period.localeCompare(right.period))
    .slice(-count);
}

export function getLiveProgression(report: PublicFundReportV2): LiveProgressPoint[] {
  if (report.liveMonths.length === 0) {
    return [];
  }

  const inceptionPeriod = report.liveInceptionDate?.slice(0, 7) ?? report.liveMonths[0]!.period;
  return [
    {
      period: inceptionPeriod,
      label: "Inception",
      closingNav: report.startingNav,
      cumulativeReturnPercent: 0,
    },
    ...report.liveMonths.map((month) => ({
      ...month,
      label: formatPeriod(month.period, true),
      cumulativeReturnPercent: (month.closingNav / report.startingNav - 1) * 100,
    })),
  ];
}

export function getLatestNav(report: PublicFundReportV2): number {
  return report.liveMonths.at(-1)?.closingNav ?? report.startingNav;
}

export function calculateTotalReturn(report: PublicFundReportV2): number {
  return (getLatestNav(report) / report.startingNav - 1) * 100;
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPeriod(period: string, includeYear = false): string {
  const date = new Date(`${period}-01T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: includeYear ? "numeric" : undefined,
    timeZone: "UTC",
  }).format(date);
}
