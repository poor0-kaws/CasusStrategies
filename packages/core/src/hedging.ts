import type { RelationshipKind } from "./schemas";

export interface ScenarioPosition {
  marketId: string;
  side: "yes" | "no";
  count: number;
  price: number;
  fees: number;
}

export interface ScenarioRelationship {
  leftMarketId: string;
  rightMarketId: string;
  kind: RelationshipKind;
  verificationStatus: "verified" | "unverified" | "rejected";
}

export interface SettlementScenario {
  outcomes: Record<string, boolean>;
  pnl: number;
}

export interface ScenarioRiskResult {
  grossDeployed: number;
  worstCaseLoss: number;
  scenarios: SettlementScenario[];
}

export interface HedgeEvaluation {
  approved: boolean;
  reasons: string[];
  preHedgeScenarioLoss: number;
  postHedgeScenarioLoss: number;
  maximumOrphanLoss: number;
}

const MAXIMUM_CLUSTER_MARKETS = 8;

export function calculateScenarioRisk(
  positions: ScenarioPosition[],
  relationships: ScenarioRelationship[],
): ScenarioRiskResult {
  const marketIds = [...new Set(positions.map((position) => position.marketId))].sort();
  if (marketIds.length > MAXIMUM_CLUSTER_MARKETS) {
    throw new RangeError(
      `Scenario clusters may contain at most ${MAXIMUM_CLUSTER_MARKETS} markets`,
    );
  }

  const verified = relationships.filter(
    (relationship) => relationship.verificationStatus === "verified",
  );
  const scenarios = enumerateOutcomes(marketIds)
    .filter((outcomes) =>
      verified.every((relationship) => relationshipAllows(outcomes, relationship)),
    )
    .map((outcomes) => ({ outcomes, pnl: scenarioPnl(positions, outcomes) }));

  if (marketIds.length > 0 && scenarios.length === 0) {
    throw new Error("Verified relationships produced no valid settlement scenarios");
  }

  return {
    grossDeployed: sum(
      positions.map((position) => position.count * position.price + position.fees),
    ),
    worstCaseLoss: Math.max(0, ...scenarios.map((scenario) => -scenario.pnl)),
    scenarios,
  };
}

export function evaluateTwoLegHedge(input: {
  nav: number;
  existingPositions: ScenarioPosition[];
  hedgeLegs: [ScenarioPosition, ScenarioPosition];
  relationships: ScenarioRelationship[];
  combinedNetEdge: number;
  purpose: "new_pair" | "risk_reducing";
}): HedgeEvaluation {
  const reasons: string[] = [];
  if (!Number.isFinite(input.nav) || input.nav <= 0) {
    throw new RangeError("NAV must be positive");
  }
  if (input.relationships.some((item) => item.verificationStatus !== "verified")) {
    reasons.push("Every hedge relationship must be deterministically verified");
  }

  const preHedge = calculateScenarioRisk(input.existingPositions, input.relationships);
  const postHedge = calculateScenarioRisk(
    [...input.existingPositions, ...input.hedgeLegs],
    input.relationships,
  );
  const maximumOrphanLoss = Math.max(
    ...input.hedgeLegs.map(
      (leg) =>
        calculateScenarioRisk([...input.existingPositions, leg], input.relationships).worstCaseLoss,
    ),
  );
  if (maximumOrphanLoss > input.nav * 0.01) {
    reasons.push("Maximum orphan-leg loss exceeds 1% of NAV");
  }

  if (input.purpose === "new_pair" && input.combinedNetEdge < 0.04) {
    reasons.push("New hedge pair has less than 4% combined conservative edge");
  }
  if (input.purpose === "risk_reducing" && postHedge.worstCaseLoss >= preHedge.worstCaseLoss) {
    reasons.push("Risk-reducing hedge does not reduce worst-case loss");
  }

  return {
    approved: reasons.length === 0,
    reasons,
    preHedgeScenarioLoss: preHedge.worstCaseLoss,
    postHedgeScenarioLoss: postHedge.worstCaseLoss,
    maximumOrphanLoss,
  };
}

function enumerateOutcomes(marketIds: string[]): Array<Record<string, boolean>> {
  const count = 2 ** marketIds.length;
  return Array.from({ length: count }, (_, mask) =>
    Object.fromEntries(
      marketIds.map((marketId, index) => [marketId, Boolean(mask & (1 << index))]),
    ),
  );
}

function relationshipAllows(
  outcomes: Record<string, boolean>,
  relationship: ScenarioRelationship,
): boolean {
  const left = outcomes[relationship.leftMarketId];
  const right = outcomes[relationship.rightMarketId];
  if (left === undefined || right === undefined) {
    return true;
  }

  if (relationship.kind === "equivalent") {
    return left === right;
  }
  if (["requires", "threshold_order", "date_subset"].includes(relationship.kind)) {
    return !left || right;
  }
  if (relationship.kind === "mutually_exclusive") {
    return !(left && right);
  }
  if (relationship.kind === "exhaustive") {
    return left !== right;
  }
  return false;
}

function scenarioPnl(positions: ScenarioPosition[], outcomes: Record<string, boolean>): number {
  return sum(
    positions.map((position) => {
      const outcome = outcomes[position.marketId] ?? false;
      const wins = position.side === "yes" ? outcome : !outcome;
      const payout = wins ? position.count : 0;
      return payout - position.count * position.price - position.fees;
    }),
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
