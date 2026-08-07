import type { Forecast, OrderPreview, TradeIntent } from "./schemas";

export interface ConservativeEdgeInput {
  side: "yes" | "no";
  lowerYesProbability: number;
  upperYesProbability: number;
  executablePrice: number;
  feePerContract: number;
  simulationPenalty: number;
}

export function calculateConservativeEdge(input: ConservativeEdgeInput): number {
  const conservativeProbability =
    input.side === "yes" ? input.lowerYesProbability : 1 - input.upperYesProbability;

  return (
    conservativeProbability - input.executablePrice - input.feePerContract - input.simulationPenalty
  );
}

export interface QuarterKellyInput {
  probability: number;
  allInPrice: number;
  nav: number;
  maximumLoss: number;
  visibleDepth: number;
}

export interface QuarterKellySize {
  fullKellyFraction: number;
  quarterKellyFraction: number;
  stake: number;
  count: number;
}

export function calculateQuarterKellySize(input: QuarterKellyInput): QuarterKellySize {
  if (input.probability <= input.allInPrice) {
    return { fullKellyFraction: 0, quarterKellyFraction: 0, stake: 0, count: 0 };
  }

  if (input.allInPrice <= 0 || input.allInPrice >= 1 || input.nav <= 0) {
    return { fullKellyFraction: 0, quarterKellyFraction: 0, stake: 0, count: 0 };
  }

  const fullKellyFraction = (input.probability - input.allInPrice) / (1 - input.allInPrice);
  const quarterKellyFraction = Math.max(0, Math.min(1, fullKellyFraction / 4));
  const desiredStake = input.nav * quarterKellyFraction;
  const stake = Math.min(desiredStake, Math.max(0, input.maximumLoss));
  const affordableCount = Math.floor(stake / input.allInPrice);
  const count = Math.max(0, Math.min(affordableCount, Math.floor(input.visibleDepth)));

  return {
    fullKellyFraction,
    quarterKellyFraction,
    stake: count * input.allInPrice,
    count,
  };
}

export interface PreviewEdgeInput {
  forecast: Forecast;
  intent: TradeIntent;
  preview: OrderPreview;
  simulationPenalty: number;
}

export function calculatePreviewEdge(input: PreviewEdgeInput): number {
  const feePerContract = input.intent.count === 0 ? 0 : input.preview.fees / input.intent.count;

  return calculateConservativeEdge({
    side: input.intent.yesNo,
    lowerYesProbability: input.forecast.lowerProbability,
    upperYesProbability: input.forecast.upperProbability,
    executablePrice: input.preview.averagePrice,
    feePerContract,
    simulationPenalty: input.simulationPenalty,
  });
}
