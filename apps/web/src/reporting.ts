import type { FundReport, MonthEndRecord } from "./data/fund-report";

export interface MonthlyReturn extends MonthEndRecord {
  returnPercent: number;
}

export function calculateMonthlyReturns(report: FundReport): MonthlyReturn[] {
  return report.months.map((month, index) => {
    const previousNav = index === 0 ? report.startingNav : report.months[index - 1].closingNav;
    const returnPercent = (month.closingNav / previousNav - 1) * 100;

    return { ...month, returnPercent };
  });
}

export function getLatestMonthlyReturns(report: FundReport, count = 6): MonthlyReturn[] {
  if (count <= 0) {
    return [];
  }

  return calculateMonthlyReturns(report).slice(-count);
}

export function calculateTotalReturn(report: FundReport): number {
  const latestMonth = report.months.at(-1);

  if (!latestMonth) {
    return 0;
  }

  return (latestMonth.closingNav / report.startingNav - 1) * 100;
}

export function formatPercent(value: number): string {
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}%`;
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
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
