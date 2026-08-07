import type { ContractVersion, RelationshipKind } from "./schemas";

export interface RelationshipProposal {
  kind: RelationshipKind;
  left: ContractVersion;
  right: ContractVersion;
  exhaustiveOutcomeKeys?: string[];
}

export interface RelationshipVerification {
  verified: boolean;
  reasons: string[];
}

function sameCoreEvent(left: ContractVersion, right: ContractVersion): boolean {
  return (
    left.facts.subjectKey === right.facts.subjectKey &&
    left.facts.metricKey === right.facts.metricKey &&
    left.facts.geographyKey === right.facts.geographyKey &&
    left.resolutionSource === right.resolutionSource
  );
}

function sameThreshold(left: ContractVersion, right: ContractVersion): boolean {
  return (
    left.facts.thresholdOperator === right.facts.thresholdOperator &&
    left.facts.thresholdValue === right.facts.thresholdValue &&
    left.facts.unit === right.facts.unit
  );
}

function verifyThresholdOrder(left: ContractVersion, right: ContractVersion): boolean {
  if (!sameCoreEvent(left, right)) {
    return false;
  }

  if (left.deadline !== right.deadline || left.facts.unit !== right.facts.unit) {
    return false;
  }

  const leftValue = left.facts.thresholdValue;
  const rightValue = right.facts.thresholdValue;
  if (leftValue === undefined || rightValue === undefined) {
    return false;
  }

  const leftOperator = left.facts.thresholdOperator;
  const rightOperator = right.facts.thresholdOperator;
  const bothLowerBounds =
    ["gt", "gte"].includes(leftOperator ?? "") && ["gt", "gte"].includes(rightOperator ?? "");
  const bothUpperBounds =
    ["lt", "lte"].includes(leftOperator ?? "") && ["lt", "lte"].includes(rightOperator ?? "");

  if (bothLowerBounds) {
    return leftValue >= rightValue;
  }

  if (bothUpperBounds) {
    return leftValue <= rightValue;
  }

  return false;
}

export function verifyRelationship(proposal: RelationshipProposal): RelationshipVerification {
  const { left, right, kind } = proposal;

  if (left.id === right.id) {
    return { verified: false, reasons: ["A contract cannot relate to itself"] };
  }

  if (kind === "equivalent") {
    const verified =
      sameCoreEvent(left, right) && sameThreshold(left, right) && left.deadline === right.deadline;
    return verified
      ? { verified: true, reasons: [] }
      : { verified: false, reasons: ["Structured contract facts do not match exactly"] };
  }

  if (kind === "threshold_order" || kind === "requires") {
    const verified = verifyThresholdOrder(left, right);
    return verified
      ? { verified: true, reasons: [] }
      : { verified: false, reasons: ["The structured thresholds do not prove implication"] };
  }

  if (kind === "date_subset") {
    const sameEventAndPayoff = sameCoreEvent(left, right) && sameThreshold(left, right);
    const verified =
      sameEventAndPayoff &&
      left.facts.timeMonotonic === true &&
      right.facts.timeMonotonic === true &&
      Date.parse(left.deadline) <= Date.parse(right.deadline);
    return verified
      ? { verified: true, reasons: [] }
      : {
          verified: false,
          reasons: ["The event or deadline ordering does not prove a date subset"],
        };
  }

  if (kind === "mutually_exclusive") {
    const sameSet =
      left.facts.outcomeSetKey !== undefined &&
      left.facts.outcomeSetKey === right.facts.outcomeSetKey;
    const verified = sameSet && left.facts.outcomeKey !== right.facts.outcomeKey;
    return verified
      ? { verified: true, reasons: [] }
      : {
          verified: false,
          reasons: ["Distinct outcomes from one declared outcome set are required"],
        };
  }

  if (kind === "exhaustive") {
    const declared = proposal.exhaustiveOutcomeKeys ?? [];
    const actual = [left.facts.outcomeKey, right.facts.outcomeKey];
    const sameSet =
      left.facts.outcomeSetKey !== undefined &&
      left.facts.outcomeSetKey === right.facts.outcomeSetKey;
    const verified =
      sameSet &&
      declared.length === 2 &&
      new Set(declared).size === 2 &&
      actual.every((outcome) => declared.includes(outcome));
    return verified
      ? { verified: true, reasons: [] }
      : {
          verified: false,
          reasons: ["The declared outcomes do not prove a complete two-outcome set"],
        };
  }

  return { verified: false, reasons: ["Relationship kind is not supported"] };
}
