const MIN_PROBABILITY = 1e-9;
const MAX_PROBABILITY = 1 - MIN_PROBABILITY;

function assertProbability(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new RangeError(`${name} must be between 0 and 1`);
  }
}

function clampForOdds(probability: number): number {
  return Math.min(MAX_PROBABILITY, Math.max(MIN_PROBABILITY, probability));
}

export function probabilityToOdds(probability: number): number {
  assertProbability(probability, "probability");
  const safeProbability = clampForOdds(probability);
  return safeProbability / (1 - safeProbability);
}

export function oddsToProbability(odds: number): number {
  if (!Number.isFinite(odds) || odds < 0) {
    throw new RangeError("odds must be a non-negative number");
  }

  if (odds === Number.POSITIVE_INFINITY) {
    return 1;
  }

  return odds / (1 + odds);
}

export function probabilityToLogOdds(probability: number): number {
  return Math.log(probabilityToOdds(probability));
}

export function logOddsToProbability(logOdds: number): number {
  if (!Number.isFinite(logOdds)) {
    throw new RangeError("logOdds must be finite");
  }

  if (logOdds >= 0) {
    const inverse = Math.exp(-logOdds);
    return 1 / (1 + inverse);
  }

  const exponent = Math.exp(logOdds);
  return exponent / (1 + exponent);
}

export function applyLikelihoodRatio(priorProbability: number, likelihoodRatio: number): number {
  assertProbability(priorProbability, "priorProbability");
  if (!Number.isFinite(likelihoodRatio) || likelihoodRatio <= 0) {
    throw new RangeError("likelihoodRatio must be greater than 0");
  }

  const posteriorOdds = probabilityToOdds(priorProbability) * likelihoodRatio;
  return oddsToProbability(posteriorOdds);
}

export interface WeightedProbability {
  probability: number;
  weight?: number;
}

export function combineProbabilitiesInLogOdds(inputs: WeightedProbability[]): number {
  if (inputs.length === 0) {
    throw new RangeError("At least one probability is required");
  }

  let weightedLogOdds = 0;
  let totalWeight = 0;

  for (const input of inputs) {
    assertProbability(input.probability, "probability");
    const weight = input.weight ?? 1;
    if (!Number.isFinite(weight) || weight <= 0) {
      throw new RangeError("weight must be greater than 0");
    }

    weightedLogOdds += probabilityToLogOdds(input.probability) * weight;
    totalWeight += weight;
  }

  return logOddsToProbability(weightedLogOdds / totalWeight);
}

export function shrinkProbabilityTowardMarket(
  estimate: number,
  marketProbability: number,
  estimateWeight: number,
): number {
  assertProbability(estimate, "estimate");
  assertProbability(marketProbability, "marketProbability");
  if (!Number.isFinite(estimateWeight) || estimateWeight < 0 || estimateWeight > 1) {
    throw new RangeError("estimateWeight must be between 0 and 1");
  }

  const estimateLogOdds = probabilityToLogOdds(estimate);
  const marketLogOdds = probabilityToLogOdds(marketProbability);
  const blendedLogOdds = estimateLogOdds * estimateWeight + marketLogOdds * (1 - estimateWeight);

  return logOddsToProbability(blendedLogOdds);
}
