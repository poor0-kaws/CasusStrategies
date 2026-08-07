// This file reads the sanitized monthly report bundled into the static website.

import generatedReport from "./generated/fund-report.json";

export type ResearchCategory =
  "weather" | "economics" | "public_policy" | "legal_regulatory" | "corporate_events";

export interface BacktestMonth {
  period: string;
  returnPercent: number;
}

export interface LiveMonth {
  period: string;
  closingNav: number;
}

export interface SectorAllocation {
  category: ResearchCategory;
  percent: number;
}

export interface PublicFundReportV2 {
  schemaVersion: 2;
  fundName: "Casus Strategies";
  startingNav: number;
  liveInceptionDate: string | null;
  asOf: string;
  backtestMonths: BacktestMonth[];
  liveMonths: LiveMonth[];
  sectorAllocation: SectorAllocation[];
}

export const fundReport = generatedReport as PublicFundReportV2;
