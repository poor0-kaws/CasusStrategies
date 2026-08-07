import { describe, expect, it, vi } from "vitest";

import { PolymarketRulesAdapter } from "../src/adapters/rules";

describe("PolymarketRulesAdapter", () => {
  it("looks up canonical condition IDs with the condition_ids filter", async () => {
    const conditionId = `0x${"a".repeat(64)}`;
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json([
        {
          id: "123",
          conditionId,
          question: "Will the release exceed expectations?",
          description: "Resolves Yes when the official release exceeds the threshold.",
          endDate: "2026-09-01T12:00:00Z",
          resolutionSource: "https://example.gov/release",
        },
      ]),
    );
    const adapter = new PolymarketRulesAdapter({ fetcher });

    const rules = await adapter.getRules(conditionId);

    expect(fetcher.mock.calls[0]?.[0]).toContain(`condition_ids=${conditionId}`);
    expect(rules.marketId).toBe(conditionId);
  });
});
