import { z } from "zod";
import { describe, expect, it, vi } from "vitest";

import { GroqClient, GroqQuotaError } from "../src/adapters/groq";
import type { GroqUsage, ResearchStore } from "../src/store/research-store";

describe("GroqClient", () => {
  it("caches identical valid work and records the attempted request first", async () => {
    const usage = new Map<string, GroqUsage>();
    const cache = new Map<string, { value: unknown; quotaReliable: boolean }>();
    const store = createUsageStore(usage, cache);
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(
        {
          choices: [{ message: { content: '{"answer":42}' } }],
          usage: { prompt_tokens: 20, completion_tokens: 5 },
        },
        { headers: completeQuotaHeaders() },
      ),
    );
    const client = new GroqClient({ apiKey: "test", fetcher, store });
    const request = {
      model: "llama-3.1-8b-instant",
      system: "Return JSON.",
      user: "What is six times seven?",
      schema: z.object({ answer: z.number() }),
    };

    await expect(client.completeJson(request)).resolves.toMatchObject({ value: { answer: 42 } });
    await expect(client.completeJson(request)).resolves.toMatchObject({ value: { answer: 42 } });

    expect(fetcher).toHaveBeenCalledOnce();
    expect(usage.get("llama-3.1-8b-instant")?.requestCount).toBe(1);
    expect(cache.size).toBe(1);
  });

  it("keeps a failed request charged against the internal hard cap", async () => {
    const usage = new Map<string, GroqUsage>();
    const store = createUsageStore(usage, new Map());
    const client = new GroqClient({
      apiKey: "test",
      store,
      fetcher: vi.fn<typeof fetch>().mockResolvedValue(new Response("down", { status: 503 })),
    });

    await expect(
      client.completeJson({
        model: "llama-3.1-8b-instant",
        system: "Return JSON.",
        user: "test",
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toBeInstanceOf(GroqQuotaError);

    expect(usage.get("llama-3.1-8b-instant")?.requestCount).toBe(1);
    expect(usage.get("llama-3.1-8b-instant")?.outputTokens).toBe(1_000);
  });

  it("rejects an oversized prompt before spending a request", async () => {
    const usage = new Map<string, GroqUsage>();
    const fetcher = vi.fn<typeof fetch>();
    const client = new GroqClient({
      apiKey: "test",
      store: createUsageStore(usage, new Map()),
      fetcher,
    });

    await expect(
      client.completeJson({
        model: "openai/gpt-oss-20b",
        system: "Return JSON.",
        user: "x".repeat(30_000),
        schema: z.object({ ok: z.boolean() }),
        maxOutputTokens: 2_000,
      }),
    ).rejects.toThrow("Single-request token hard cap");
    expect(fetcher).not.toHaveBeenCalled();
    expect(usage.size).toBe(0);
  });

  it("stops before the next request would cross the 80 percent quota cap", async () => {
    const usage = new Map<string, GroqUsage>([
      [
        "llama-3.1-8b-instant",
        {
          date: "2026-08-07",
          model: "llama-3.1-8b-instant",
          requestCount: 1,
          inputTokens: 100,
          outputTokens: 100,
          remainingRequests: 20,
          remainingTokens: 21_000,
          limitRequests: 100,
          limitTokens: 100_000,
          resetRequests: "1d",
          resetTokens: "1m",
        },
      ],
    ]);
    const fetcher = vi.fn<typeof fetch>();
    const client = new GroqClient({
      apiKey: "test",
      store: createUsageStore(usage, new Map()),
      fetcher,
    });

    await expect(
      client.completeJson({
        model: "llama-3.1-8b-instant",
        system: "Return JSON.",
        user: "test",
        schema: z.object({ ok: z.boolean() }),
      }),
    ).rejects.toThrow("Groq request leeway reached");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("retries malformed structured output only once", async () => {
    const usage = new Map<string, GroqUsage>();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { choices: [{ message: { content: "not-json" } }], usage: {} },
          { headers: completeQuotaHeaders() },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          { choices: [{ message: { content: '{"ok":true}' } }], usage: {} },
          { headers: completeQuotaHeaders() },
        ),
      );
    const client = new GroqClient({
      apiKey: "test",
      store: createUsageStore(usage, new Map()),
      fetcher,
    });

    await expect(
      client.completeJson({
        model: "llama-3.1-8b-instant",
        system: "Return JSON.",
        user: "test",
        schema: z.object({ ok: z.boolean() }),
      }),
    ).resolves.toMatchObject({ value: { ok: true } });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(usage.get("llama-3.1-8b-instant")?.requestCount).toBe(2);
  });
});

function createUsageStore(
  usage: Map<string, GroqUsage>,
  cache: Map<string, { value: unknown; quotaReliable: boolean }>,
): ResearchStore {
  return {
    countGroqRequests: vi.fn(async () =>
      [...usage.values()].reduce((sum, item) => sum + item.requestCount, 0),
    ),
    getGroqUsage: vi.fn(async (_date: string, model: string) => usage.get(model) ?? null),
    saveGroqUsage: vi.fn(async (item: GroqUsage) => {
      usage.set(item.model, item);
    }),
    getModelCache: vi.fn(async (key: string) => cache.get(key) ?? null),
    saveModelCache: vi.fn(
      async (input: { cacheKey: string; value: unknown; quotaReliable: boolean }) => {
        cache.set(input.cacheKey, { value: input.value, quotaReliable: input.quotaReliable });
      },
    ),
  } as unknown as ResearchStore;
}

function completeQuotaHeaders(): HeadersInit {
  return {
    "x-ratelimit-remaining-requests": "99",
    "x-ratelimit-remaining-tokens": "99999",
    "x-ratelimit-limit-requests": "100",
    "x-ratelimit-limit-tokens": "100000",
    "x-ratelimit-reset-requests": "1d",
    "x-ratelimit-reset-tokens": "1m",
  };
}
