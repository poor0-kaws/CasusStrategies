import { FundCoordinator } from "./coordinator";
import { verifyWebhookSignature } from "./crypto";
import type { Env } from "./env";
import { getScheduledWindow } from "./schedule";

export { FundCoordinator };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/webhooks/predarena") {
      return new Response("Not found", { status: 404 });
    }

    const rawBody = await request.text();
    const signatureValid = await verifyWebhookSignature({
      body: rawBody,
      signatureHeader: request.headers.get("x-predarena-signature"),
      timestampHeader: null,
      secret: env.PREDARENA_WEBHOOK_SECRET,
    });
    if (!signatureValid) {
      return new Response("Invalid signature", { status: 401 });
    }

    const stub = coordinatorStub(env);
    return stub.fetch("https://fund-coordinator/internal/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: rawBody,
    });
  },

  async scheduled(
    controller: ScheduledController,
    env: Env,
    context: ExecutionContext,
  ): Promise<void> {
    const scheduledAt = new Date(controller.scheduledTime);
    if (!getScheduledWindow(scheduledAt)) {
      return;
    }

    const stub = coordinatorStub(env);
    context.waitUntil(
      stub
        .fetch("https://fund-coordinator/internal/scheduled", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scheduledAt: scheduledAt.toISOString() }),
        })
        .then((response) => {
          if (!response.ok) {
            throw new Error(`Scheduled research failed with status ${response.status}`);
          }
        }),
    );
  },
} satisfies ExportedHandler<Env>;

function coordinatorStub(env: Env): DurableObjectStub {
  const id = env.FUND_COORDINATOR.idFromName("casus-paper-portfolio");
  return env.FUND_COORDINATOR.get(id);
}
