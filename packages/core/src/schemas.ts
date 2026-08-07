import { z } from "zod";

const probabilitySchema = z.number().min(0).max(1);
const nonNegativeMoneySchema = z.number().finite().nonnegative();
const isoDateTimeSchema = z.string().datetime({ offset: true });

export const venueSchema = z.enum(["kalshi", "polymarket"]);
export type Venue = z.infer<typeof venueSchema>;

export const researchCategorySchema = z.enum([
  "weather",
  "economics",
  "public_policy",
  "legal_regulatory",
  "corporate_events",
]);
export type ResearchCategory = z.infer<typeof researchCategorySchema>;

export const contractFactsSchema = z.object({
  subjectKey: z.string().min(1),
  metricKey: z.string().min(1),
  outcomeKey: z.string().min(1),
  outcomeSetKey: z.string().min(1).optional(),
  thresholdOperator: z.enum(["gt", "gte", "lt", "lte", "eq"]).optional(),
  thresholdValue: z.number().finite().optional(),
  unit: z.string().min(1).optional(),
  geographyKey: z.string().min(1).optional(),
  timeMonotonic: z.boolean().optional(),
});
export type ContractFacts = z.infer<typeof contractFactsSchema>;

export const contractVersionSchema = z.object({
  id: z.string().min(1),
  marketId: z.string().min(1),
  ticker: z.string().min(1),
  venue: venueSchema,
  title: z.string().min(1),
  question: z.string().min(1),
  yesCondition: z.string().min(1),
  noCondition: z.string().min(1),
  deadline: isoDateTimeSchema,
  resolutionSource: z.string().min(1),
  edgeCases: z.array(z.string().min(1)),
  ambiguityScore: probabilitySchema,
  contentHash: z.string().min(1),
  ruleVersion: z.string().min(1),
  observedAt: isoDateTimeSchema,
  facts: contractFactsSchema,
});
export type ContractVersion = z.infer<typeof contractVersionSchema>;

export const orderBookLevelSchema = z.object({
  price: probabilitySchema,
  quantity: z.number().int().positive(),
});
export type OrderBookLevel = z.infer<typeof orderBookLevelSchema>;

export const marketSnapshotSchema = z.object({
  id: z.string().min(1),
  marketId: z.string().min(1),
  ticker: z.string().min(1),
  venue: venueSchema,
  title: z.string().min(1),
  yesBids: z.array(orderBookLevelSchema).max(10),
  yesAsks: z.array(orderBookLevelSchema).max(10),
  noBids: z.array(orderBookLevelSchema).max(10),
  noAsks: z.array(orderBookLevelSchema).max(10),
  displayedPrice: probabilitySchema,
  volume: nonNegativeMoneySchema,
  liquidity: nonNegativeMoneySchema,
  closesAt: isoDateTimeSchema,
  feeRate: probabilitySchema,
  observedAt: isoDateTimeSchema,
  storedAt: isoDateTimeSchema,
  rawResponseHash: z.string().min(1),
});
export type MarketSnapshot = z.infer<typeof marketSnapshotSchema>;

export const sourceDocumentSchema = z.object({
  id: z.string().min(1),
  url: z.string().url(),
  publisher: z.string().min(1),
  excerpt: z.string().max(4_000),
  sourcePublishedAt: isoDateTimeSchema,
  observedAt: isoDateTimeSchema,
  storedAt: isoDateTimeSchema,
  contentHash: z.string().min(1),
  approved: z.boolean(),
});
export type SourceDocument = z.infer<typeof sourceDocumentSchema>;

export const relationshipKindSchema = z.enum([
  "equivalent",
  "requires",
  "mutually_exclusive",
  "exhaustive",
  "threshold_order",
  "date_subset",
]);
export type RelationshipKind = z.infer<typeof relationshipKindSchema>;

export const relationshipSchema = z.object({
  id: z.string().min(1),
  leftContractId: z.string().min(1),
  rightContractId: z.string().min(1),
  kind: relationshipKindSchema,
  explanation: z.string().min(1),
  verificationStatus: z.enum(["verified", "unverified", "rejected"]),
  confidence: probabilitySchema,
  ruleVersion: z.string().min(1),
  createdAt: isoDateTimeSchema,
  reviewerStatus: z.enum(["not_requested", "pending", "approved", "rejected"]),
});
export type Relationship = z.infer<typeof relationshipSchema>;

export const forecastSchema = z
  .object({
    id: z.string().min(1),
    marketId: z.string().min(1),
    createdAt: isoDateTimeSchema,
    informationCutoffAt: isoDateTimeSchema,
    pointProbability: probabilitySchema,
    lowerProbability: probabilitySchema,
    upperProbability: probabilitySchema,
    marketPrior: probabilitySchema,
    likelihoodRatios: z.array(z.number().finite().positive()),
    modelFamily: z.string().min(1),
    category: researchCategorySchema,
  })
  .refine(
    (forecast) =>
      forecast.lowerProbability <= forecast.pointProbability &&
      forecast.pointProbability <= forecast.upperProbability,
    { message: "Probability bounds must contain the point estimate" },
  );
export type Forecast = z.infer<typeof forecastSchema>;

export const tradeIntentSchema = z.object({
  intentId: z.string().min(1),
  forecastId: z.string().min(1),
  strategy: z.enum(["slow_value_v1", "verified_hedge_v1"]),
  category: researchCategorySchema,
  venue: venueSchema,
  ticker: z.string().min(1),
  relatedEventClusterId: z.string().min(1),
  hedgePlanId: z.string().min(1).optional(),
  action: z.literal("buy"),
  yesNo: z.enum(["yes", "no"]),
  count: z.number().int().positive(),
  maximumPrice: probabilitySchema,
  minimumNetEdge: probabilitySchema,
  createdAt: isoDateTimeSchema,
});
export type TradeIntent = z.infer<typeof tradeIntentSchema>;

export const riskDecisionSchema = z.object({
  intentId: z.string().min(1),
  approved: z.boolean(),
  reasons: z.array(z.string().min(1)),
  proposedMaximumLoss: nonNegativeMoneySchema,
  marketExposureAfter: nonNegativeMoneySchema,
  clusterExposureAfter: nonNegativeMoneySchema,
  totalExposureAfter: nonNegativeMoneySchema,
  decidedAt: isoDateTimeSchema,
});
export type RiskDecision = z.infer<typeof riskDecisionSchema>;

export const orderPreviewSchema = z.object({
  intentId: z.string().min(1),
  executable: z.boolean(),
  averagePrice: probabilitySchema,
  fees: nonNegativeMoneySchema,
  requiredCash: nonNegativeMoneySchema,
  availableDepth: z.number().int().nonnegative(),
  previewedAt: isoDateTimeSchema,
});
export type OrderPreview = z.infer<typeof orderPreviewSchema>;

export const orderRecordSchema = z.object({
  id: z.string().min(1),
  clientOrderId: z.string().min(1),
  intentId: z.string().min(1),
  venue: venueSchema,
  ticker: z.string().min(1),
  yesNo: z.enum(["yes", "no"]),
  orderType: z.enum(["FOK", "IOC"]),
  count: z.number().int().positive(),
  limitPrice: probabilitySchema,
  status: z.enum(["pending", "filled", "partially_filled", "cancelled", "rejected", "unknown"]),
  submittedAt: isoDateTimeSchema,
});
export type OrderRecord = z.infer<typeof orderRecordSchema>;

export const fillRecordSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  count: z.number().int().positive(),
  price: probabilitySchema,
  fee: nonNegativeMoneySchema,
  filledAt: isoDateTimeSchema,
});
export type FillRecord = z.infer<typeof fillRecordSchema>;

export const portfolioSnapshotSchema = z.object({
  id: z.string().min(1),
  cash: nonNegativeMoneySchema,
  positionValue: nonNegativeMoneySchema,
  nav: nonNegativeMoneySchema,
  openMaximumLoss: nonNegativeMoneySchema,
  realizedPnl: z.number().finite(),
  unrealizedPnl: z.number().finite(),
  observedAt: isoDateTimeSchema,
});
export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotSchema>;

export const monthlyReportSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  closingNav: nonNegativeMoneySchema,
  returnPercent: z.number().finite(),
});
export type MonthlyReport = z.infer<typeof monthlyReportSchema>;
