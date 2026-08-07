import type { TradeIntent } from "./schemas";

export interface RiskLimits {
  maximumMarketFraction: number;
  maximumClusterFraction: number;
  maximumTotalFraction: number;
  minimumHoursToClose: number;
  minimumVisibleExitContracts: number;
  maximumNewPositionsPerDay: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  maximumMarketFraction: 0.01,
  maximumClusterFraction: 0.05,
  maximumTotalFraction: 0.2,
  minimumHoursToClose: 6,
  minimumVisibleExitContracts: 1,
  maximumNewPositionsPerDay: 2,
};

export interface RiskCheckInput {
  intent: TradeIntent;
  nav: number;
  marketExposure: number;
  clusterExposure: number;
  totalOpenExposure: number;
  ambiguityScore: number;
  maximumAllowedAmbiguity: number;
  visibleExitContracts: number;
  closesAt: string;
  now: string;
  existingPositionCount: number;
  newPositionsToday: number;
  apiResponseKnown: boolean;
  limits?: RiskLimits;
}

export interface RiskCheckResult {
  approved: boolean;
  reasons: string[];
  proposedMaximumLoss: number;
  marketExposureAfter: number;
  clusterExposureAfter: number;
  totalExposureAfter: number;
}

export function evaluateRisk(input: RiskCheckInput): RiskCheckResult {
  const limits = input.limits ?? DEFAULT_RISK_LIMITS;
  const proposedMaximumLoss = input.intent.count * input.intent.maximumPrice;
  const marketExposureAfter = input.marketExposure + proposedMaximumLoss;
  const clusterExposureAfter = input.clusterExposure + proposedMaximumLoss;
  const totalExposureAfter = input.totalOpenExposure + proposedMaximumLoss;
  const reasons: string[] = [];

  if (!input.apiResponseKnown) {
    reasons.push("API response is unknown");
  }

  if (input.ambiguityScore > input.maximumAllowedAmbiguity) {
    reasons.push("Contract rules are too ambiguous");
  }

  if (
    input.visibleExitContracts < Math.max(limits.minimumVisibleExitContracts, input.intent.count)
  ) {
    reasons.push("Visible exit liquidity is insufficient");
  }

  const closesAt = Date.parse(input.closesAt);
  const now = Date.parse(input.now);
  const hoursToClose = (closesAt - now) / 3_600_000;
  if (!Number.isFinite(hoursToClose) || hoursToClose < limits.minimumHoursToClose) {
    reasons.push("Market closes too soon");
  }

  if (input.existingPositionCount > 0) {
    reasons.push("Automatic averaging down is disabled");
  }

  if (input.newPositionsToday >= limits.maximumNewPositionsPerDay) {
    reasons.push("Daily new-position limit reached");
  }

  if (marketExposureAfter > input.nav * limits.maximumMarketFraction) {
    reasons.push("Per-market loss limit exceeded");
  }

  if (clusterExposureAfter > input.nav * limits.maximumClusterFraction) {
    reasons.push("Related-event loss limit exceeded");
  }

  if (totalExposureAfter > input.nav * limits.maximumTotalFraction) {
    reasons.push("Total open-exposure limit exceeded");
  }

  return {
    approved: reasons.length === 0,
    reasons,
    proposedMaximumLoss,
    marketExposureAfter,
    clusterExposureAfter,
    totalExposureAfter,
  };
}
