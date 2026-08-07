import { z } from "zod";

import { GroqClient } from "./adapters/groq";
import { PredArenaAdapter } from "./adapters/predarena";
import { KalshiRulesAdapter, PolymarketRulesAdapter, RulesRouter } from "./adapters/rules";
import {
  CorporateEventsSourceAdapter,
  EconomicsSourceAdapter,
  LegalRegulatorySourceAdapter,
  OfficialSourceRouter,
  PublicPolicySourceAdapter,
  WeatherSourceAdapter,
} from "./adapters/sources";
import { PointInTimeCollector } from "./collector";
import { sha256Hex } from "./crypto";
import type { Env } from "./env";
import { IntelligenceAgents } from "./intelligence";
import { ResearchPipeline } from "./pipeline";
import { GitHubReportPublisher, ReportingService } from "./reporting";
import { getScheduledWindow } from "./schedule";
import { D1ResearchStore } from "./store/d1-research-store";

const WebhookEventSchema = z
  .object({
    id: z.string().min(1).optional(),
    event_id: z.string().min(1).optional(),
    type: z.string().min(1).optional(),
    event_type: z.string().min(1).optional(),
  })
  .passthrough();

export class FundCoordinator implements DurableObject {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: Env,
  ) {
    void this.state;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/internal/scheduled") {
      return this.serialize(() => this.handleScheduled(request));
    }
    if (request.method === "POST" && url.pathname === "/internal/webhook") {
      return this.serialize(() => this.handleWebhook(request));
    }
    return new Response("Not found", { status: 404 });
  }

  private async serialize(work: () => Promise<Response>): Promise<Response> {
    const result = this.queue.then(work, work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async handleScheduled(request: Request): Promise<Response> {
    const input = (await request.json()) as { scheduledAt?: string };
    const now = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
    const window = getScheduledWindow(now);
    if (!window) {
      return Response.json({ status: "outside_window" });
    }

    const store = new D1ResearchStore(this.env.RESEARCH_DB);
    const started = await store.beginRun(window.runKey, "research", now.toISOString());
    if (!started) {
      return Response.json({ status: "duplicate" });
    }

    try {
      const result = await createPipeline(
        this.env,
        store,
        () => now,
        window.maximumModelRequests,
      ).run(window);
      const reporting = await runReporting(this.env, store, now);
      const details = { ...result, reporting };
      await store.completeRun(window.runKey, "completed", details, new Date().toISOString());
      return Response.json({ status: "completed", ...details });
    } catch (error) {
      await store.completeRun(
        window.runKey,
        "failed",
        { error: safeError(error) },
        new Date().toISOString(),
      );
      return Response.json({ status: "failed" }, { status: 503 });
    }
  }

  private async handleWebhook(request: Request): Promise<Response> {
    const rawBody = await request.text();
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response("Invalid webhook", { status: 400 });
    }
    const parsed = WebhookEventSchema.safeParse(body);
    if (!parsed.success) {
      return new Response("Invalid webhook", { status: 400 });
    }

    const eventId = parsed.data.id ?? parsed.data.event_id;
    const eventType = parsed.data.type ?? parsed.data.event_type;
    if (!eventId || !eventType) {
      return new Response("Invalid webhook", { status: 400 });
    }

    const store = new D1ResearchStore(this.env.RESEARCH_DB);
    const receivedAt = new Date().toISOString();
    const isNew = await store.recordWebhook({
      id: eventId,
      eventType,
      payloadHash: await sha256Hex(rawBody),
      receivedAt,
    });
    if (!isNew) {
      return Response.json({ status: "duplicate" });
    }

    this.state.waitUntil(this.processWebhook(store, eventId, eventType));
    return Response.json({ status: "accepted" }, { status: 202 });
  }

  private async processWebhook(
    store: D1ResearchStore,
    eventId: string,
    eventType: string,
  ): Promise<void> {
    try {
      await createPipeline(this.env, store).reconcile(`webhook:${eventType}`);
      await store.markWebhookProcessed(eventId, new Date().toISOString());
    } catch {
      // An unprocessed event remains visible to the next cycle's reconciliation.
    }
  }
}

async function runReporting(env: Env, store: D1ResearchStore, now: Date): Promise<unknown> {
  try {
    const service = new ReportingService({
      store,
      publisher: new GitHubReportPublisher({
        token: env.GITHUB_REPORTS_TOKEN,
        repository: env.GITHUB_REPOSITORY,
        branch: env.GITHUB_REPORTS_BRANCH,
        reportPath: env.REPORT_PATH,
      }),
      startingNav: Number(env.FUND_STARTING_NAV),
      inceptionDate: env.FUND_INCEPTION_DATE,
    });
    return await service.evaluateAndPublish(now, env.TRADING_MODE);
  } catch (error) {
    return { evaluation: "failed", publication: "failed", error: safeError(error) };
  }
}

function createPipeline(
  env: Env,
  store: D1ResearchStore,
  now: () => Date = () => new Date(),
  maximumModelRequests = 0,
): ResearchPipeline {
  const predArena = new PredArenaAdapter({
    apiKey: env.PREDARENA_API_KEY,
    baseUrl: env.PREDARENA_BASE_URL,
  });
  const collector = new PointInTimeCollector(predArena, store, now);
  const rules = new RulesRouter(new KalshiRulesAdapter(), new PolymarketRulesAdapter());
  const sources = new OfficialSourceRouter(
    new WeatherSourceAdapter({ now, contactEmail: env.SOURCE_CONTACT_EMAIL }),
    new EconomicsSourceAdapter({ now, contactEmail: env.SOURCE_CONTACT_EMAIL }),
    new PublicPolicySourceAdapter({
      now,
      contactEmail: env.SOURCE_CONTACT_EMAIL,
      apiKeysByHost: {
        "api.congress.gov": { parameter: "api_key", value: env.CONGRESS_API_KEY },
        "api.open.fec.gov": { parameter: "api_key", value: env.FEC_API_KEY },
      },
    }),
    new LegalRegulatorySourceAdapter({ now, contactEmail: env.SOURCE_CONTACT_EMAIL }),
    new CorporateEventsSourceAdapter({ now, contactEmail: env.SOURCE_CONTACT_EMAIL }),
  );
  const groq = new GroqClient({
    apiKey: env.GROQ_API_KEY,
    baseUrl: env.GROQ_BASE_URL,
    store,
    now,
    maximumRequestsThisCycle: maximumModelRequests,
  });
  return new ResearchPipeline({
    store,
    predArena,
    collector,
    rules,
    sources,
    agents: new IntelligenceAgents(groq, {
      triage: env.GROQ_MODEL_TRIAGE,
      contract: env.GROQ_MODEL_CONTRACT,
      evidence: env.GROQ_MODEL_EVIDENCE,
      skeptic: env.GROQ_MODEL_SKEPTIC,
    }),
    tradingMode: env.TRADING_MODE,
    now,
  });
}

function safeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 500);
  }
  return "Unknown error";
}
