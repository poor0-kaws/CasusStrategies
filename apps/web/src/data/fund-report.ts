import generatedReport from "./generated/fund-report.json";

export interface MonthEndRecord {
  period: string;
  closingNav: number;
}

export interface FundReport {
  fundName: string;
  startingNav: number;
  inceptionDate: string;
  asOf: string;
  status: "illustrative" | "official";
  months: MonthEndRecord[];
}

// The Worker replaces only this generated public data after a verified paper month closes.
export const fundReport = generatedReport as FundReport;
