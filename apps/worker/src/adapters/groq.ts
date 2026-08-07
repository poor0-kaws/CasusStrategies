import type { z } from "zod";

import { sha256Hex } from "../crypto";
import { newYorkDate } from "../schedule";
import type { ResearchStore } from "../store/research-store";

export const GROQ_MODELS = {
  triage: "llama-3.1-8b-instant",
  contract: "openai/gpt-oss-120b",
  evidence: "openai/gpt-oss-20b",
  skeptic: "llama-3.3-70b-versatile",
} as const;

const TOKEN_HARD_CAPS: Record<string, number> = {
  [GROQ_MODELS.triage]: 400_000,
  [GROQ_MODELS.contract]: 160_000,
  [GROQ_MODELS.evidence]: 160_000,
  [GROQ_MODELS.skeptic]: 80_000,
};

const REQUEST_TOKEN_HARD_CAPS: Record<string, number> = {
  [GROQ_MODELS.triage]: 4_800,
  [GROQ_MODELS.contract]: 6_400,
  [GROQ_MODELS.evidence]: 6_400,
  [GROQ_MODELS.skeptic]: 9_600,
};

const DAILY_REQUEST_HARD_CAP = 10;

interface GroqClientOptions {
  apiKey: string;
  store: ResearchStore;
  baseUrl?: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}

export interface GroqResult<T> {
  value: T;
  quotaReliable: boolean;
}

export class GroqQuotaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqQuotaError";
  }
}

export class GroqClient {
  private readonly apiKey: string;
  private readonly store: ResearchStore;
  private readonly baseUrl: string;
  private readonly fetcher: typeof fetch;
  private readonly now: () => Date;

  constructor(options: GroqClientOptions) {
    this.apiKey = options.apiKey;
    this.store = options.store;
    this.baseUrl = options.baseUrl ?? "https://api.groq.com/openai/v1";
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  async completeJson<T>(input: {
    model: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxOutputTokens?: number;
  }): Promise<GroqResult<T>> {
    const cacheKey = await sha256Hex(
      JSON.stringify([input.model, input.system, input.user, input.maxOutputTokens ?? 1_000]),
    );
    const cached = await this.store.getModelCache(cacheKey);
    if (cached) {
      const parsed = input.schema.safeParse(cached.value);
      if (parsed.success) {
        return { value: parsed.data, quotaReliable: cached.quotaReliable };
      }
    }

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const result = await this.completeJsonOnce(input);
        await this.store.saveModelCache({
          cacheKey,
          model: input.model,
          value: result.value,
          quotaReliable: result.quotaReliable,
          createdAt: this.now().toISOString(),
        });
        return result;
      } catch (error) {
        lastError = error;
        if (error instanceof GroqQuotaError) {
          throw error;
        }
      }
    }

    throw new Error(`Groq returned invalid structured output twice: ${String(lastError)}`);
  }

  private async completeJsonOnce<T>(input: {
    model: string;
    system: string;
    user: string;
    schema: z.ZodType<T>;
    maxOutputTokens?: number;
  }): Promise<GroqResult<T>> {
    if (!this.apiKey) {
      throw new GroqQuotaError("Groq API key is missing");
    }

    const date = newYorkDate(this.now());
    const maximumOutputTokens = input.maxOutputTokens ?? 1_000;
    const estimatedInputTokens = estimateTokens(input.system) + estimateTokens(input.user);
    await this.assertBudget(date, input.model, estimatedInputTokens + maximumOutputTokens);
    await this.reserveUsage(date, input.model, estimatedInputTokens, maximumOutputTokens);

    const response = await this.fetcher(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: input.model,
        temperature: 0,
        max_completion_tokens: maximumOutputTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });

    if (!response.ok) {
      throw new GroqQuotaError(`Groq request stopped with status ${response.status}`);
    }

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Groq response did not contain JSON content");
    }

    await this.recordUsage(
      date,
      input.model,
      response.headers,
      body.usage,
      estimatedInputTokens,
      maximumOutputTokens,
    );
    const parsedJson: unknown = JSON.parse(content);
    return {
      value: input.schema.parse(parsedJson),
      quotaReliable: hasCompleteQuotaHeaders(response.headers),
    };
  }

  private async assertBudget(date: string, model: string, requestedTokens: number): Promise<void> {
    const totalRequests = await this.store.countGroqRequests(date);
    if (totalRequests >= DAILY_REQUEST_HARD_CAP) {
      throw new GroqQuotaError("Daily Groq request cap reached");
    }

    const hardCap = TOKEN_HARD_CAPS[model] ?? 60_000;
    const requestHardCap = REQUEST_TOKEN_HARD_CAPS[model] ?? 6_400;
    if (requestedTokens >= requestHardCap) {
      throw new GroqQuotaError(`Single-request token hard cap reached for ${model}`);
    }

    const usage = await this.store.getGroqUsage(date, model);
    if (!usage) {
      return;
    }

    const tokensUsed = usage.inputTokens + usage.outputTokens;
    if (tokensUsed + requestedTokens >= hardCap) {
      throw new GroqQuotaError(`Daily token hard cap reached for ${model}`);
    }
    if (usage.remainingRequests !== null && usage.remainingRequests <= 0) {
      throw new GroqQuotaError(`Groq reports no requests remaining for ${model}`);
    }
    if (usage.remainingTokens !== null && usage.remainingTokens <= requestedTokens) {
      throw new GroqQuotaError(`Groq reports insufficient tokens remaining for ${model}`);
    }
    if (wouldUseReservedAllowance(usage.remainingRequests, usage.limitRequests, 1)) {
      throw new GroqQuotaError(`Groq request leeway reached for ${model}`);
    }
    if (wouldUseReservedAllowance(usage.remainingTokens, usage.limitTokens, requestedTokens)) {
      throw new GroqQuotaError(`Groq token leeway reached for ${model}`);
    }
  }

  private async reserveUsage(
    date: string,
    model: string,
    estimatedInputTokens: number,
    maximumOutputTokens: number,
  ): Promise<void> {
    const existing = await this.store.getGroqUsage(date, model);
    await this.store.saveGroqUsage({
      date,
      model,
      requestCount: (existing?.requestCount ?? 0) + 1,
      inputTokens: (existing?.inputTokens ?? 0) + estimatedInputTokens,
      outputTokens: (existing?.outputTokens ?? 0) + maximumOutputTokens,
      remainingRequests: existing?.remainingRequests ?? null,
      remainingTokens: existing?.remainingTokens ?? null,
      limitRequests: existing?.limitRequests ?? null,
      limitTokens: existing?.limitTokens ?? null,
      resetRequests: existing?.resetRequests ?? null,
      resetTokens: existing?.resetTokens ?? null,
    });
  }

  private async recordUsage(
    date: string,
    model: string,
    headers: Headers,
    responseUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
    reservedInputTokens: number,
    reservedOutputTokens: number,
  ): Promise<void> {
    const existing = await this.store.getGroqUsage(date, model);
    await this.store.saveGroqUsage({
      date,
      model,
      requestCount: existing?.requestCount ?? 1,
      inputTokens:
        (existing?.inputTokens ?? reservedInputTokens) -
        reservedInputTokens +
        (responseUsage?.prompt_tokens ?? reservedInputTokens),
      outputTokens:
        (existing?.outputTokens ?? reservedOutputTokens) -
        reservedOutputTokens +
        (responseUsage?.completion_tokens ?? reservedOutputTokens),
      remainingRequests: readHeaderNumber(headers, "x-ratelimit-remaining-requests"),
      remainingTokens: readHeaderNumber(headers, "x-ratelimit-remaining-tokens"),
      limitRequests: readHeaderNumber(headers, "x-ratelimit-limit-requests"),
      limitTokens: readHeaderNumber(headers, "x-ratelimit-limit-tokens"),
      resetRequests: headers.get("x-ratelimit-reset-requests"),
      resetTokens: headers.get("x-ratelimit-reset-tokens"),
    });
  }
}

function estimateTokens(value: string): number {
  return Math.ceil(value.length / 4);
}

function wouldUseReservedAllowance(
  remaining: number | null,
  allowance: number | null,
  requested: number,
): boolean {
  if (remaining === null || allowance === null) {
    return false;
  }
  if (allowance <= 0) {
    return true;
  }
  return (remaining - requested) / allowance < 0.2;
}

function readHeaderNumber(headers: Headers, name: string): number | null {
  const value = headers.get(name);
  if (value === null) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function hasCompleteQuotaHeaders(headers: Headers): boolean {
  return (
    readHeaderNumber(headers, "x-ratelimit-remaining-requests") !== null &&
    readHeaderNumber(headers, "x-ratelimit-remaining-tokens") !== null &&
    readHeaderNumber(headers, "x-ratelimit-limit-requests") !== null &&
    readHeaderNumber(headers, "x-ratelimit-limit-tokens") !== null &&
    headers.has("x-ratelimit-reset-requests") &&
    headers.has("x-ratelimit-reset-tokens")
  );
}
